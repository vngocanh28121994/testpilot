# `ui/` — app Vite + React (đang dựng)

Thư mục này sẽ chứa bảng điều khiển mới của TestPilot, theo chuẩn `sen/frontend`.
Kế hoạch đầy đủ: [`../UI-MIGRATION-PLAN.md`](../UI-MIGRATION-PLAN.md).

**Hiện tại chỉ có Phase 0 (nền móng chất lượng).** Phase 1 sẽ scaffold Vite vào đây.

Vài điều đúng ngay từ bây giờ:

- `ui/` **không có `package.json` riêng** — dependency nằm ở `package.json` gốc (§5.1).
- Chỉ file trong `ui/` mới bị Prettier/lint-staged đụng tới (§6.3). `src/` được giữ nguyên.
- Qua ranh giới `ui/` → `src/` chỉ được `import type`, không bao giờ import giá trị (§6.1c).
