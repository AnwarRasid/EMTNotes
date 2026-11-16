import { defineConfig, devices } from '@playwright/test';

// Checks against the production build, served by vite preview, in two projects (Global Constraints, ruling W1):
// - phone: 390px, every spec but the save profile, and every screenshot baseline;
// - pixel: Playwright's Pixel 7 (Chromium, Android user agent, 412×839), for the run flows and the save profile, and
//   Plan 3's voice and smart tester flows (Task 12).
export default defineConfig({
  testDir: 'tests/e2e',
  snapshotPathTemplate: '{testDir}/__screens__/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true }, testIgnore: /perf\.spec\.ts/ },
    { name: 'pixel', use: { ...devices['Pixel 7'] }, testMatch: /(run|perf|voice|smart)\.spec\.ts/ },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
