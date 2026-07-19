import { devices, defineConfig } from '@playwright/test';

// Sandboxes with a system-managed Chromium (e.g. remote dev containers) can
// point the suite at it instead of downloading a matching build.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    port: 4173,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4173',
        launchOptions: { executablePath },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        baseURL: 'http://127.0.0.1:4173',
        launchOptions: { executablePath },
      },
    },
  ],
});
