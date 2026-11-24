import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL targets an already running instance (for example the published
// demo). Without it the suite builds and starts the app locally.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const executablePath = process.env.PW_CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'ar-MA',
    timezoneId: 'Africa/Casablanca',
    trace: 'off',
    launchOptions,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions } },
  ],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'node scripts/e2e-server.mjs',
          url: `${baseURL}/healthz`,
          timeout: 300_000,
          reuseExistingServer: false,
        },
      }),
});
