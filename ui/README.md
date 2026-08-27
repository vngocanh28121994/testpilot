# `ui/` — bảng điều khiển React của TestPilot

Đây là React 19 SPA của TestPilot, dùng Vite, TanStack Router/Query và Tailwind. Nó đã thay
giao diện client cũ; production bundle được build vào `../dist/ui/app` và do
`../src/ui/server.ts` phục vụ cùng API trên cổng 4300.

Kế hoạch và nhật ký migration: [`../UI-MIGRATION-PLAN.md`](../UI-MIGRATION-PLAN.md).

## Chạy và kiểm tra

Tất cả dependency và script nằm trong `package.json` gốc; `ui/` không có `package.json` riêng.

```bash
npm run ui             # build bundle và chạy server production ở :4300
npm run ui:dev         # Vite HMR ở :5173; proxy API/artifact về :4300
npm run ui:lint
npm run ui:typecheck
npm run ui:test
npm run ui:test:e2e
npm run ui:build
```

Playwright trong `ui/e2e/` kiểm tra chính bảng điều khiển. Nó khác với Playwright driver của
sản phẩm (`src/drivers/web.ts`, `generated/tests/`) chạy bằng `npm run run:web`.

## Cấu trúc

| Đường dẫn                   | Vai trò                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `src/routes/`               | File-based routes TanStack; route chỉ ghép panel, không chứa nghiệp vụ.                   |
| `src/panels/`               | Các màn Dashboard, Studio, Kịch bản, Healing, Builds, Runner, Farm và Settings.           |
| `src/api/`                  | Client JSON, SSE-over-POST và upload có tiến trình; không gọi `fetch` trực tiếp từ panel. |
| `src/hooks/`, `src/stores/` | State đọc từ `/api/state` và trạng thái job streaming sống qua unmount/đổi trang.         |
| `src/components/`           | Layout, theme, status pill và data table dùng lại.                                        |
| `src/test/`, `e2e/`         | Mock API/MSW, Vitest và Playwright của UI.                                                |

## Ranh giới với backend

- Chỉ dùng `import type` khi đi từ `ui/` sang `src/`; không import giá trị backend vào bundle
  trình duyệt.
- `src/ui/contracts.ts` là hợp đồng type giữa hai phía. Khi thêm route/payload, cập nhật contract
  trước rồi thêm mock và test phù hợp.
- Trong dev, Vite proxy `/api`, `/runs`, `/reports` và `/artifacts` sang server :4300. Trong
  production, server phục vụ trực tiếp cả bundle, API và artifact, bao gồm HTTP Range cho video.
- Secret không được trả về UI. Response chỉ có các cờ như `hasPassword` hoặc `hasApiKey`; form
  chỉ cho phép ghi secret mới.
