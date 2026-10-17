import { defineConfig } from '@playwright/test'

/** Opt-in genuine live-provider checks (real Blockscout / GoPlus over the network). Run: npm run e2e:live */
const API_PORT = 8011
const WEB_PORT = 5181

export default defineConfig({
  testDir: './e2e-live',
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, channel: 'chrome', viewport: { width: 1440, height: 900 } },
  webServer: [
    {
      command: `rm -rf ../backend/var/e2e-live && TRACEFUSE_DB_PATH=../backend/var/e2e-live/db.sqlite3 ../backend/.venv/bin/uvicorn tracefuse.api.app:app --app-dir ../backend --host 127.0.0.1 --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/ready`,
      reuseExistingServer: false,
    },
    {
      command: `TRACEFUSE_API=http://127.0.0.1:${API_PORT} npx vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
})
