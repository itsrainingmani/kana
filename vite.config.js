import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  server: {
    port: 4173,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())]
    }
  },
  preview: {
    port: 4173,
  },
  worker: {
    format: 'es'
  }
});
