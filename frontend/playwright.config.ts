import { defineConfig, devices } from '@playwright/test'

/**
 * Deterministic browser E2E suite — no credentials, no network.
 * The API runs with TRACEFUSE_OFFLINE=1 against a fresh database: historical cases replay the genuine recorded
 * Ronin dataset through the real pipeline, and every live provider call fails honestly ("offline").
 * Genuine live-provider checks live in playwright.live.config.ts (opt-in).
 */
const API_PORT = 8010
const WEB_PORT = 5180

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    channel: 'chrome', // system Google Chrome — no bundled browser download required
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } }, testIgnore: /responsive/ },
    { name: 'responsive-desktop', use: { viewport: { width: 1280, height: 800 } }, testMatch: /responsive/ },
    { name: 'responsive-mobile', use: { ...devices['Pixel 7'], channel: 'chrome' }, testMatch: /responsive/ },
  ],
  webServer: [
    {
      command: `rm -rf ../backend/var/e2e && TRACEFUSE_OFFLINE=1 TRACEFUSE_DB_PATH=../backend/var/e2e/db.sqlite3 ../backend/.venv/bin/uvicorn tracefuse.api.app:app --app-dir ../backend --host 127.0.0.1 --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `TRACEFUSE_API=http://127.0.0.1:${API_PORT} npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
