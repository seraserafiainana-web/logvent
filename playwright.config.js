const { defineConfig, devices } = require('@playwright/test');

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    headless: true,
  },
  webServer: {
    command: 'npx http-server . -p 8000',
    port: 8000,
  },
});
