import { defineConfig } from '@playwright/test';

const site = 'http://127.0.0.1:15173';
const api = 'http://127.0.0.1:18787';

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: site,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  webServer: [
    {
      command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 15173 --strictPort',
      url: site,
      env: { VITE_API_URL: api },
    },
    {
      command: 'npx wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e && npx wrangler dev --ip 127.0.0.1 --port 18787 --persist-to .wrangler/e2e --env-file .dev.vars.example --var FRONTEND_URL:http://127.0.0.1:15173/',
      url: api + '/api/health',
      env: { WRANGLER_SEND_METRICS: 'false' },
    },
  ],
});
