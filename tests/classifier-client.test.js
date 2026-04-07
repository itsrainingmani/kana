import { describe, expect, it } from 'vitest';
import { createClassifierClient } from '../src/classifier-client.js';

function createMockWorker() {
  const listeners = new Set();
  const posts = [];

  return {
    posts,
    addEventListener(type, listener) {
      if (type === 'message') {
        listeners.add(listener);
      }
    },
    postMessage(payload) {
      posts.push(payload);
    },
    respond(payload) {
      for (const listener of listeners) {
        listener({ data: payload });
      }
    }
  };
}

describe('classifier client', () => {
  it('routes classify requests through the worker', async () => {
    const worker = createMockWorker();
    const client = createClassifierClient({ workerFactory: () => worker });

    const pending = client.classify({ promptId: 'prompt-1', strokes: [], candidates: ['あ'] });

    expect(worker.posts).toHaveLength(1);
    expect(worker.posts[0]).toMatchObject({
      type: 'classify',
      promptId: 'prompt-1',
      candidates: ['あ']
    });

    worker.respond({
      type: 'result',
      requestId: worker.posts[0].requestId,
      promptId: 'prompt-1',
      matches: [{ glyph: 'あ', confidence: 0.9 }]
    });

    await expect(pending).resolves.toMatchObject({
      type: 'result',
      matches: [{ glyph: 'あ', confidence: 0.9 }]
    });
  });

  it('marks stale responses as ignored', async () => {
    const worker = createMockWorker();
    const client = createClassifierClient({ workerFactory: () => worker });

    const first = client.classify({ promptId: 'old', strokes: [], candidates: ['あ'] });
    const second = client.classify({ promptId: 'new', strokes: [], candidates: ['い'] });

    worker.respond({
      type: 'result',
      requestId: worker.posts[1].requestId,
      promptId: 'new',
      matches: [{ glyph: 'い', confidence: 0.8 }]
    });
    worker.respond({
      type: 'result',
      requestId: worker.posts[0].requestId,
      promptId: 'old',
      matches: [{ glyph: 'あ', confidence: 0.9 }]
    });

    await expect(second).resolves.toMatchObject({ matches: [{ glyph: 'い', confidence: 0.8 }] });
    await expect(first).resolves.toMatchObject({ ignored: true });
  });
});
