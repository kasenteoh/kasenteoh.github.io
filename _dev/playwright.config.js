const { defineConfig, devices } = require('@playwright/test');

const external = !!process.env.PLAYWRIGHT_BASE_URL;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8770/';

module.exports = defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  webServer: external
    ? undefined
    : {
        command: 'python3 -m http.server 8770 --bind 127.0.0.1 --directory ..',
        url: 'http://127.0.0.1:8770/',
        reuseExistingServer: true,
      },
  use: { baseURL },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'chromium-phone', use: { browserName: 'chromium', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: 'webkit-desktop', use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
    { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } },
  ],
});
