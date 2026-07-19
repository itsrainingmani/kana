// Loader + forward pass for the write-mode character recognizer.
//
// The model ships as a single ~100 KB binary (assets/models/kana-writer.bin,
// format documented in ml/export.py): a JSON header describing the layer
// stack + labels, followed by per-output-channel int8 weights that are
// dequantized to float32 once at load. Inference is a hand-written conv net
// over typed arrays — a few million MACs, single-digit milliseconds — so the
// app carries no ML runtime dependency at all.
//
// Tensor layout everywhere: channel-major Float32Array [c][y][x], matching
// extractFeatures() in recognizer-features.js.

import { FEATURE_CHANNELS, FEATURE_GRID, FEATURE_VERSION } from './recognizer-features.js';

function parseModel(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );

  if (magic !== 'KWM1') {
    throw new Error(`Unexpected model magic: ${magic}`);
  }

  const headerLength = view.getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength))
  );

  if (header.featureVersion !== FEATURE_VERSION) {
    throw new Error(
      `Model feature version ${header.featureVersion} != runtime ${FEATURE_VERSION}`
    );
  }
  if (header.grid !== FEATURE_GRID || header.channels !== FEATURE_CHANNELS) {
    throw new Error('Model input shape does not match the feature extractor');
  }

  let offset = 8 + headerLength;
  const readInt8 = (count) => {
    const array = new Int8Array(buffer, offset, count);
    offset += count;
    return array;
  };
  const readFloat32 = (count) => {
    // buffer.slice realigns to a 4-byte boundary regardless of offset.
    const array = new Float32Array(buffer.slice(offset, offset + count * 4));
    offset += count * 4;
    return array;
  };

  const layers = header.layers.map((spec) => {
    if (spec.type === 'gap') {
      return { ...spec };
    }

    const fanIn = spec.type === 'conv' ? spec.in * spec.k * spec.k : spec.in;
    const quantized = readInt8(spec.out * fanIn);
    const scales = readFloat32(spec.out);
    const bias = readFloat32(spec.out);
    const weights = new Float32Array(quantized.length);

    for (let outChannel = 0; outChannel < spec.out; outChannel += 1) {
      const scale = scales[outChannel];
      const base = outChannel * fanIn;
      for (let index = 0; index < fanIn; index += 1) {
        weights[base + index] = quantized[base + index] * scale;
      }
    }

    return { ...spec, weights, bias };
  });

  if (offset !== buffer.byteLength) {
    throw new Error(`Model payload size mismatch: ${offset} != ${buffer.byteLength}`);
  }

  return { header, layers };
}

function convForward(input, size, layer) {
  const { k, in: inChannels, out: outChannels, pad } = layer;
  const output = new Float32Array(outChannels * size * size);
  const area = size * size;

  for (let outChannel = 0; outChannel < outChannels; outChannel += 1) {
    const weightBase = outChannel * inChannels * k * k;
    const outBase = outChannel * area;
    const bias = layer.bias[outChannel];

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let sum = bias;

        for (let inChannel = 0; inChannel < inChannels; inChannel += 1) {
          const inBase = inChannel * area;
          const kernelBase = weightBase + inChannel * k * k;

          for (let ky = 0; ky < k; ky += 1) {
            const sy = y + ky - pad;
            if (sy < 0 || sy >= size) {
              continue;
            }
            const rowBase = inBase + sy * size;
            const kernelRow = kernelBase + ky * k;

            for (let kx = 0; kx < k; kx += 1) {
              const sx = x + kx - pad;
              if (sx < 0 || sx >= size) {
                continue;
              }
              sum += input[rowBase + sx] * layer.weights[kernelRow + kx];
            }
          }
        }

        output[outBase + y * size + x] = layer.relu && sum < 0 ? 0 : sum;
      }
    }
  }

  return output;
}

function maxPool2(input, channels, size) {
  const half = size >> 1;
  const output = new Float32Array(channels * half * half);

  for (let channel = 0; channel < channels; channel += 1) {
    const inBase = channel * size * size;
    const outBase = channel * half * half;

    for (let y = 0; y < half; y += 1) {
      for (let x = 0; x < half; x += 1) {
        const corner = inBase + y * 2 * size + x * 2;
        const a = input[corner];
        const b = input[corner + 1];
        const c = input[corner + size];
        const d = input[corner + size + 1];
        output[outBase + y * half + x] = Math.max(a, b, c, d);
      }
    }
  }

  return output;
}

function globalAveragePool(input, channels, size) {
  const area = size * size;
  const output = new Float32Array(channels);

  for (let channel = 0; channel < channels; channel += 1) {
    let sum = 0;
    const base = channel * area;
    for (let index = 0; index < area; index += 1) {
      sum += input[base + index];
    }
    output[channel] = sum / area;
  }

  return output;
}

function linearForward(input, layer) {
  const output = new Float32Array(layer.out);

  for (let outIndex = 0; outIndex < layer.out; outIndex += 1) {
    let sum = layer.bias[outIndex];
    const base = outIndex * layer.in;
    for (let inIndex = 0; inIndex < layer.in; inIndex += 1) {
      sum += input[inIndex] * layer.weights[base + inIndex];
    }
    output[outIndex] = sum;
  }

  return output;
}

export function softmax(logits) {
  let max = -Infinity;
  for (const value of logits) {
    if (value > max) {
      max = value;
    }
  }
  let sum = 0;
  const out = new Float32Array(logits.length);
  for (let index = 0; index < logits.length; index += 1) {
    out[index] = Math.exp(logits[index] - max);
    sum += out[index];
  }
  for (let index = 0; index < logits.length; index += 1) {
    out[index] /= sum;
  }
  return out;
}

export function createRecognizerFromBuffer(buffer) {
  const { header, layers } = parseModel(buffer);
  const labelIndex = new Map(header.labels.map((label, index) => [label, index]));

  function infer(features) {
    let activations = features;
    let size = FEATURE_GRID;
    let channels = FEATURE_CHANNELS;

    for (const layer of layers) {
      if (layer.type === 'conv') {
        activations = convForward(activations, size, layer);
        channels = layer.out;
        if (layer.pool) {
          activations = maxPool2(activations, channels, size);
          size >>= 1;
        }
      } else if (layer.type === 'gap') {
        activations = globalAveragePool(activations, channels, size);
        size = 1;
      } else if (layer.type === 'linear') {
        activations = linearForward(activations, layer);
      }
    }

    return activations;
  }

  return {
    labels: header.labels,
    metrics: header.metrics ?? null,
    arch: header.arch,
    infer,
    classify(features, topK = 5) {
      const logits = infer(features);
      const probs = softmax(logits);
      const order = Array.from(probs.keys()).sort((a, b) => probs[b] - probs[a]);
      return {
        logits,
        top: order.slice(0, topK).map((index) => ({
          label: header.labels[index],
          prob: probs[index]
        }))
      };
    },
    indexOfLabel(label) {
      return labelIndex.get(label) ?? -1;
    }
  };
}

let recognizerPromise = null;

// Lazy singleton used by the write drill; modelUrl comes from a `?url`
// import so vite fingerprints the binary.
export function loadRecognizer(modelUrl, fetchImpl = globalThis.fetch) {
  if (!recognizerPromise) {
    recognizerPromise = Promise.resolve()
      .then(() => fetchImpl(modelUrl))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Model fetch failed: HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((buffer) => createRecognizerFromBuffer(buffer))
      .catch((error) => {
        recognizerPromise = null;
        throw error;
      });
  }

  return recognizerPromise;
}
