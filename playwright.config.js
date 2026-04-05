import { devices, defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  webServer: {
    command: 'npm run dev',
    port: 4173,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], baseURL: 'http://127.0.0.1:4173' },
    },
  ],
});
