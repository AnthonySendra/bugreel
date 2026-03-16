import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:7777',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Uncomment to auto-start the dev server during CI:
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:7777',
  //   reuseExistingServer: true,
  // },
})
