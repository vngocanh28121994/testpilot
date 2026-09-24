import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@evidence': path.resolve(import.meta.dirname, '../src/report/evidenceView.ts'),
      // Cùng lý do: câu lỗi thân thiện phải giống nhau ở server và giao diện.
      '@friendlyError': path.resolve(import.meta.dirname, '../src/core/friendlyError.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:5173' } },
    /**
     * 5 giây (mặc định) đang đo TẢI CỦA MÁY, không đo code.
     *
     * 71 file test, mỗi file dựng riêng một jsdom và một server MSW, chạy song
     * song hết số lõi. Đo ngày 2026-09-18: `knownIssueDialog` chạy 1,5 giây khi
     * đứng một mình và timeout ở 5 giây khi chạy cùng cả suite — cùng một code,
     * khác mỗi số tiến trình đang tranh CPU. Một hạn như thế biến máy yếu hoặc
     * một lần build nền thành "test đỏ", và đó là kiểu đỏ dạy người ta chạy lại
     * cho tới khi xanh.
     *
     * 15 giây vẫn bắt được test treo thật — thứ hạn này sinh ra để bắt — mà
     * không bắt nhầm một cái máy đang bận.
     */
    testTimeout: 15_000,
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    // e2e/ là Playwright, không phải Vitest. Chạy nhầm là một đống lỗi
    // "test.describe is not a function" không nói lên điều gì.
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: ['src/test/**', 'src/routeTree.gen.ts', '*.config.*'],
    },
  },
});
