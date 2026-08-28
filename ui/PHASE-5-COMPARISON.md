# Phase 5 — checklist đối chiếu UI cũ và UI mới

Ngày kiểm: 2026-08-27. Checklist được ghi trước cutover; UI React nay phục vụ tại `/`.

> **Bảng này đo theo TRANG, không theo THAO TÁC.** Bằng chứng của nó là "route
> tồn tại và render được" — đúng ở mức đó, và chỉ ở mức đó. Một đợt đối chiếu
> sâu hơn (2026-08-28) tìm ra 17 khoảng cách nghiệp vụ mà bảng này không thấy;
> ví dụ dòng "Local Runner ✅" trong khi bản React không có một nút prereq nào.
>
> Danh sách đầy đủ và kế hoạch lấp: [`../REACT-PARITY-PLAN.md`](../REACT-PARITY-PLAN.md).
> Cột "Còn thiếu" dưới đây đã được thêm vào; ✅ ở cột "Mới" chỉ có nghĩa "trang
> có tồn tại".

| Bề mặt             | Cũ                        | Mới (mức trang)                   | Còn thiếu ở mức thao tác (§ trong REACT-PARITY-PLAN)                                                                                                  |
| ------------------ | ------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Điều hướng         | 14 mục                    | 14 mục                            | —                                                                                                                                                     |
| Dashboard          | số liệu + feature table   | panel Dashboard hiện hữu          | —                                                                                                                                                     |
| Healing Center     | lọc + review              | lọc + review mutation             | —                                                                                                                                                     |
| Personal Settings  | config/secret form        | config/secret form                | —                                                                                                                                                     |
| Studio             | lưu + workflow stream     | lưu + SSE workflow                | ✅ dẫn sang gate (§2.2), ✅ thanh stage (§3.5); còn trình soạn Môi trường (§3.1), chọn model (§3.4)                                                   |
| Scenario Review    | lọc, review, bulk, editor | URL filters, review, bulk, editor | ✅ Workflow Gate (§2.1); còn chuẩn hoá + duyệt action (§2.3), thêm/xoá kịch bản (§3.2), tag đa chọn (§4.1), `pomWarnings` (§4.7), bảng cú pháp (§4.8) |
| Workflow History   | card/log/report link      | card/log/report link              | —                                                                                                                                                     |
| Bản build          | raw upload                | raw upload XHR + progress         | —                                                                                                                                                     |
| Local Runner       | run/stop/log/report       | run/stop/jobStore/log/report      | nút prereq (§2.4), chọn nhiều thiết bị (§3.3), thẻ bản build (§4.5), slowMo (§4.6), bộ lọc lịch sử (§4.2)                                             |
| E2E History        | report iframe/artifacts   | iframe, screenshot, network log   | tab platform, lọc tuần/máy, video có chương (§4.3)                                                                                                    |
| Device Farm        | AWS/pool/run stream       | AWS/pool/run stream               | ✅ thanh stage (§3.5); còn lọc thiết bị, lọc tag, hướng dẫn biến env (§4.4), bộ lọc lịch sử (§4.2)                                                    |
| Farm Run Detail    | stage, video, log         | stage, video, log                 | video có chương (§4.3)                                                                                                                                |
| Placeholder `todo` | giải thích 6 mục chưa nối | cùng `why` từ NAV                 | —                                                                                                                                                     |

## Kiểm tra giao diện

- [x] Light/dark: Theme switch thay class `dark`; test browser xác nhận.
- [x] Mobile width 390px: không có horizontal overflow toàn trang (`scrollWidth === clientWidth`).
- [x] SPA deep links: smoke test xác nhận router trả view 404, không trả 404 server.
- [x] Bundle: production build tạo route chunk riêng cho history, builds, runner, farm, studio và scenarios.
- [x] R10: các thao tác SSE đi qua `useStreamJob`/`jobStore`, không bị panel cleanup abort.

## Cổng nghiệm thu đã chạy

- `npm run typecheck`
- `npm run ui:test` — 96 tests (71 lúc cutover; +25 từ Mốc 0/1 của parity plan)
- `npm run ui:test:e2e` — 12 tests (10 lúc cutover; +2 cho Workflow Gate)
- `npm run ui:build`

`ui/src/components/layout/__tests__/AppSidebar.test.tsx` flaky ~3/10 lần chạy cả
bộ (không flaky khi chạy riêng). Đã xác nhận có SẴN từ commit `f19c498`, không
phải hồi quy của đợt parity.

`ui:lint` không có lỗi. Nó còn một warning có sẵn từ `useReactTable`, vì React Compiler không memoize API TanStack Table một cách an toàn.
