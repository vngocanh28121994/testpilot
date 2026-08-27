import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // routeTree.gen.ts do TanStack Router sinh ra. Lint nó là báo lỗi về code
  // không ai viết, và diff rác mỗi lần thêm một route (R15).
  globalIgnores(['dist', 'src/routeTree.gen.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // ---- Ranh giới ui/ → src/ (UI-MIGRATION-PLAN §6.1c, R2) ----
      //
      // Phải là bản của typescript-eslint, KHÔNG phải rule cùng tên của ESLint
      // gốc. Rule gốc không phân biệt được `import type` với import giá trị:
      // `importNamePattern` khớp trên TÊN được import (`TestPilotConfig`), nên
      // nó chặn luôn cả thứ ta muốn cho phép. `allowTypeImports` là cờ duy nhất
      // diễn đạt đúng ý định ở đây.
      //
      // TypeScript KHÔNG gác được chỗ này: `import { ConfigSchema }` từ một file
      // .ts là hợp lệ với tsc — nó chỉ sai khi bundle cho trình duyệt. Nên rule
      // này là hàng rào duy nhất, không phải lớp thứ hai.
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@core/*', '../../src/*', '../../../src/*'],
              allowTypeImports: true,
              message:
                'Chỉ được `import type` qua ranh giới ui/ → src/. Import một giá trị sẽ kéo zod + node:fs vào bundle trình duyệt. Xem UI-MIGRATION-PLAN.md §6.1c.',
            },
          ],
        },
      ],
      // @types/node có mặt vì §6.1a, nên `process` và `__dirname` bỗng thành
      // global hợp lệ trong code trình duyệt. Đóng lại cái cửa vừa mở.
      'no-restricted-globals': [
        'error',
        { name: '__dirname', message: 'Đây là code trình duyệt.' },
        { name: '__filename', message: 'Đây là code trình duyệt.' },
      ],
    },
  },
  {
    // File config chạy bằng Node, nên các rule trên không áp dụng.
    files: ['*.config.ts', '*.config.js'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-globals': 'off' },
  },
]);
