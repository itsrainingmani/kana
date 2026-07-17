import { vi } from 'vitest';

if (typeof window !== 'undefined' && window.localStorage && !globalThis.localStorage) {
  globalThis.localStorage = window.localStorage;
} else if (!globalThis.localStorage) {
  const store = new Map();
  const localStorageShim = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    get length() {
      return store.size;
    }
  };
  globalThis.localStorage = localStorageShim;
}

if (typeof globalThis.Audio === 'undefined' || !globalThis.Audio) {
  globalThis.Audio = class {
    constructor(src) {
      this.src = src;
      this.preload = 'none';
      this.onended = null;
      this.onerror = null;
    }

    play() {
      return Promise.resolve();
    }
  };
}

if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = () => null;
}