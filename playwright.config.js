import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/content',
  testMatch: '**/*.spec.js',
  use: {
    headless: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npx http-server tests/fixtures -p 7777 -s',
    port: 7777,
    reuseExistingServer: true,
  },
});
