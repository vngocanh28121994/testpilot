import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  // routeTree.gen.ts do TanStack Router sinh ra. Lint nó là báo lỗi về code
  // không ai viết, và diff rác mỗi lần thêm một route (R15).
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results', 'src/routeTree.gen.ts']),
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
      // ---- Thay cho "erasableSyntaxOnly" của tsconfig (§6.1d) ----
      // Cờ tsconfig áp cho cả program nên nó bắt lỗi cả backend; ba rule dưới
      // đây áp đúng phạm vi ui/src và giữ nguyên ý định ban đầu: code mới phải
      // xoá-type-là-chạy-được, không có cú pháp cần biến đổi lúc build.
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],
      '@typescript-eslint/no-namespace': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Dùng union type hoặc object `as const` thay cho enum.',
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
    // Route file của TanStack Router BẮT BUỘC export một hằng tên `Route`.
    // Đó là cấu trúc của thư viện, không phải mùi code — nhưng
    // react-refresh/only-export-components thấy một export không-phải-component
    // thì kêu về mọi component trong cùng file.
    //
    // Không nới rule một cách vô điều kiện: kỷ luật thật sự là route file phải
    // MỎNG, logic nằm ở panels/ (UI-MIGRATION-PLAN §3.1). `allowExportNames`
    // chỉ dọn đúng phần nhiễu mà cấu trúc thư viện gây ra.
    files: ['src/routes/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': ['error', { allowExportNames: ['Route'] }],
    },
  },
  {
    // Helper của test không phải component và không bao giờ được fast-refresh;
    // `export * from '@testing-library/react'` là cách dùng chuẩn của
    // renderWithProviders, không phải mùi code.
    files: ['src/test/**/*.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // File config chạy bằng Node, nên các rule trên không áp dụng.
    files: ['*.config.ts', '*.config.js'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-globals': 'off' },
  },
]);
