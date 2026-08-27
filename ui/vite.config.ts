import { defineConfig } from 'vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Backend đọc cùng biến này (src/ui/server.ts:86). Hardcode 4300 ở hai nơi là
// cách chắc chắn để proxy trỏ nhầm chỗ khi ai đó đổi cổng.
const BACKEND = `http://localhost:${process.env.TESTPILOT_UI_PORT ?? 4300}`;

// Các tiền tố backend sở hữu. `/runs`, `/reports`, `/artifacts` phục vụ file
// tĩnh có HTTP Range — video của một lần chạy phải tua được (server.ts:773).
const PROXIED = ['/api', '/runs', '/reports', '/artifacts'];

export default defineConfig(() => ({
  // Config này được gọi từ thư mục gốc (`vite --config ui/vite.config.ts`), mà
  // `root` của Vite mặc định là cwd chứ không phải chỗ đặt file config. Không
  // set tường minh thì Vite đi tìm index.html ở gốc repo và không thấy gì.
  root: import.meta.dirname,

  // base tuyệt đối, không phải './' như sen. Xem UI-MIGRATION-PLAN §6.5: base
  // tương đối vỡ khi deep-link nhiều cấp. Sau cutover cả dev và production
  // đều phục vụ từ gốc; main.tsx tự đọc BASE_URL nên không cần cấu hình router
  // thứ hai.
  base: '/',

  plugins: [
    // Phải đứng trước react(): nó sinh routeTree.gen.ts mà react() sẽ transform.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // KHÔNG khai báo alias '@core' ở đây, dù tsconfig.app.json có. Cố ý:
      // '@core/*' chỉ được dùng với `import type`, thứ bị xoá sạch lúc build.
      // Nếu ai đó lỡ import một *giá trị* từ backend, Vite phải gãy ngay tại
      // chỗ đó thay vì lặng lẽ nhét node:fs vào bundle trình duyệt (§6.1c/R2).
    },
  },

  build: {
    outDir: '../dist/ui/app',
    emptyOutDir: true,
  },

  server: {
    port: 5173,
    proxy: Object.fromEntries(PROXIED.map((p) => [p, { target: BACKEND, changeOrigin: false }])),
  },
}));
