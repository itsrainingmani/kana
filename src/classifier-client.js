export function createClassifierClient({
  workerFactory = () => new Worker(new URL('./recognition-worker.js', import.meta.url), { type: 'module' })
} = {}) {
  let worker = null;
  let nextRequestId = 1;
  let latestPromptId = null;
  const pending = new Map();

  function ensureWorker() {
    if (worker) {
      return worker;
    }

    worker = workerFactory();
    worker.addEventListener('message', ({ data }) => {
      const entry = pending.get(data.requestId);

      if (!entry) {
        return;
      }

      pending.delete(data.requestId);

      if (data.type === 'error') {
        entry.reject(new Error(data.message || 'Worker classification failed'));
        return;
      }

      if (data.promptId && data.promptId !== latestPromptId) {
        entry.resolve({ ignored: true });
        return;
      }

      entry.resolve(data);
    });

    return worker;
  }

  return {
    classify({ promptId, strokes, candidates }) {
      latestPromptId = promptId;
      const requestId = nextRequestId;
      nextRequestId += 1;

      ensureWorker().postMessage({
        type: 'classify',
        requestId,
        promptId,
        strokes,
        candidates
      });

      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
      });
    },
    warmup() {
      ensureWorker().postMessage({ type: 'warmup' });
    }
  };
}
