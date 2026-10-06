import { defineConfig, devices } from '@playwright/test';

// Browser tests run the built card in demo/ against the simulated Home Assistant.
// WebGL runs on SwiftShader (software) so CI machines without a GPU render the same way every time.
export default defineConfig({
  testDir: 'test/browser',
  timeout: 60_000,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Software WebGL is slow on CI runners; give screenshots time to settle.
  expect: { timeout: 20_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  // Baselines are generated on Linux in CI, so they don't need a per-platform suffix.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:8766',
    reducedMotion: 'reduce',          // no camera tweens or radar pulse: stable frames
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: 1400, height: 900 },
      deviceScaleFactor: 1,
      launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    },
  }],
  webServer: {
    command: 'node scripts/serve.mjs 8766',
    url: 'http://localhost:8766/demo/',
    reuseExistingServer: !process.env.CI,
  },
});
