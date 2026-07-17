import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    unstubGlobals: true,
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/'
      }
    },
    setupFiles: ['tests/setup.js'],
    include: ['tests/**/*.test.js'],
  },
});
