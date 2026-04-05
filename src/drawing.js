function distance([ax, ay], [bx, by]) {
  return Math.hypot(ax - bx, ay - by);
}

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));

  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.lineWidth = 4;
  context.lineCap = 'square';
  context.lineJoin = 'miter';
  context.strokeStyle = '#111111';
  return context;
}

export function normalizeStrokeSet(strokes, bounds) {
  return strokes.map((stroke) =>
    stroke.map((point) => [
      Number((point.x / bounds.width).toFixed(3)),
      Number((point.y / bounds.height).toFixed(3))
    ])
  );
}

export function gradeStrokeSet(actual, expected) {
  if (!Array.isArray(expected) || expected.length === 0) {
    return { correct: false, outcome: 'incorrect', message: 'no stroke template available' };
  }

  if (actual.length !== expected.length) {
    return { correct: false, outcome: 'incorrect', message: 'stroke count mismatch' };
  }

  for (let index = 0; index < expected.length; index += 1) {
    const actualStroke = actual[index];
    const expectedStroke = expected[index].points;
    const startDelta = distance(actualStroke[0], expectedStroke[0]);
    const endDelta = distance(
      actualStroke[actualStroke.length - 1],
      expectedStroke[expectedStroke.length - 1]
    );

    if (startDelta + endDelta > 0.45) {
      return {
        correct: false,
        outcome: 'order-failure',
        message: `stroke ${index + 1} does not match the expected sequence`
      };
    }
  }

  return { correct: true, outcome: 'correct', message: 'correct stroke order' };
}

export function renderStrokeOrderSvg(strokes) {
  return `
    <svg viewBox="0 0 100 100" class="stroke-order-svg" aria-label="Stroke order guide">
      ${strokes
        .map((stroke, index) => {
          const path = stroke.points
            .map(([x, y], pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${x * 100} ${y * 100}`)
            .join(' ');

          return `
            <path d="${path}" data-stroke-index="${index}"></path>
            <text x="${stroke.points[0][0] * 100}" y="${stroke.points[0][1] * 100 - 4}">${index + 1}</text>
          `;
        })
        .join('')}
    </svg>
  `;
}

export function createDrawingPad(canvas) {
  const context = resizeCanvas(canvas);
  const strokes = [];
  let currentStroke = null;

  function getPoint(event) {
    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function drawSegment(from, to) {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  function pointerDown(event) {
    canvas.setPointerCapture(event.pointerId);
    currentStroke = [getPoint(event)];
    strokes.push(currentStroke);
  }

  function pointerMove(event) {
    if (!currentStroke) {
      return;
    }

    const point = getPoint(event);
    const lastPoint = currentStroke[currentStroke.length - 1];
    currentStroke.push(point);
    drawSegment(lastPoint, point);
  }

  function pointerUp(event) {
    if (!currentStroke) {
      return;
    }

    const point = getPoint(event);
    const lastPoint = currentStroke[currentStroke.length - 1];

    if (distance([lastPoint.x, lastPoint.y], [point.x, point.y]) > 0) {
      currentStroke.push(point);
      drawSegment(lastPoint, point);
    }

    currentStroke = null;
    canvas.releasePointerCapture(event.pointerId);
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', () => {
    currentStroke = null;
  });

  return {
    clear() {
      strokes.length = 0;
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
    getNormalizedStrokes() {
      const rect = canvas.getBoundingClientRect();
      return normalizeStrokeSet(strokes, {
        width: rect.width || 1,
        height: rect.height || 1
      });
    },
    destroy() {
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
    }
  };
}
