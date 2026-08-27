import { defineConfig, devices } from '@playwright/test';

// Playwright ở ĐÂY test chính bảng điều khiển TestPilot.
// Đừng nhầm với Playwright mà TestPilot dùng để chạy test của SẢN PHẨM
// (src/drivers/web.ts, generated/tests/) — chạy bằng `npm run run:web`.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Ghi vào ui/, không phải gốc repo: chạy `npm run ui:test:e2e` từ gốc thì
  // Playwright mặc định rải playwright-report/ và test-results/ ra ngay cạnh
  // package.json, lẫn với thư mục của backend.
  outputDir: './test-results',
  reporter: [['html', { open: 'never', outputFolder: './ui/playwright-report' }], ['line']],
  use: {
    // Dev server nên base là '/' (§6.5). Sau cutover cũng vẫn '/'; chỉ bản
    // build trước cutover mới nằm dưới /next/.
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run ui:dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    cwd: '..',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
