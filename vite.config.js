import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  server: {
    port: 4173,
    strictPort: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())]
    }
  },
  preview: {
    port: 4173,
    strictPort: true
  },
  worker: {
    format: 'es'
  }
});
