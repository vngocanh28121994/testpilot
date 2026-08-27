# Phase 5 — checklist đối chiếu UI cũ và UI mới

Ngày kiểm: 2026-08-27. Checklist được ghi trước cutover; UI React nay phục vụ tại `/`.

| Bề mặt             | Cũ                        | Mới                               | Bằng chứng                                             |
| ------------------ | ------------------------- | --------------------------------- | ------------------------------------------------------ |
| Điều hướng         | 14 mục                    | 14 mục                            | Browser check: `#nav button` = 14, navigation mới = 14 |
| Dashboard          | số liệu + feature table   | panel Dashboard hiện hữu          | smoke test mở app                                      |
| Healing Center     | lọc + review              | lọc + review mutation             | E2E mock review                                        |
| Personal Settings  | config/secret form        | config/secret form                | unit + smoke hiện hữu                                  |
| Studio             | lưu + workflow stream     | lưu + SSE workflow                | E2E mock `studio/save` + `/api/gen`                    |
| Scenario Review    | lọc, review, bulk, editor | URL filters, review, bulk, editor | E2E mutation + React key check                         |
| Workflow History   | card/log/report link      | card/log/report link              | route `/scenarios/history`                             |
| Bản build          | raw upload                | raw upload XHR + progress         | contract + build chunk `builds-*`                      |
| Local Runner       | run/stop/log/report       | run/stop/jobStore/log/report      | route/chunk `runner-*`                                 |
| E2E History        | report iframe/artifacts   | iframe, screenshot, network log   | route/chunk `runner.history-*`                         |
| Device Farm        | AWS/pool/run stream       | AWS/pool/run stream               | E2E mock `/api/farm/run`                               |
| Farm Run Detail    | stage, video, log         | stage, video, log                 | route/chunk `farm.$runId-*`                            |
| Placeholder `todo` | giải thích 6 mục chưa nối | cùng `why` từ NAV                 | smoke test Zephyr                                      |

## Kiểm tra giao diện

- [x] Light/dark: Theme switch thay class `dark`; test browser xác nhận.
- [x] Mobile width 390px: không có horizontal overflow toàn trang (`scrollWidth === clientWidth`).
- [x] SPA deep links: smoke test xác nhận router trả view 404, không trả 404 server.
- [x] Bundle: production build tạo route chunk riêng cho history, builds, runner, farm, studio và scenarios.
- [x] R10: các thao tác SSE đi qua `useStreamJob`/`jobStore`, không bị panel cleanup abort.

## Cổng nghiệm thu đã chạy

- `npm run typecheck`
- `npm run ui:test` — 71 tests
- `npm run ui:test:e2e` — 10 tests
- `npm run ui:build`

`ui:lint` không có lỗi. Nó còn một warning có sẵn từ `useReactTable`, vì React Compiler không memoize API TanStack Table một cách an toàn.
