import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  use: { baseURL: 'http://localhost:5178', trace: 'off' },
  webServer: {
    command: 'pnpm playground',
    url: 'http://localhost:5178',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
