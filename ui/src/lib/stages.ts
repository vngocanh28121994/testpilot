/**
 * Tên các stage ở trạng thái CHƯA CHẠY.
 *
 * Vì sao phải chép chứ không import: `WORKFLOW_STAGES` và `FARM_STAGES` trong
 * `src/core/history.ts:151,166` là **giá trị runtime** (mảng `as const`), mà
 * ranh giới `ui/` → `src/` chỉ cho phép `import type` (ràng buộc 2 của
 * `contracts.ts`, và ESLint chặn cứng chiều còn lại). Bản cũ cũng chép, ở
 * `app.js:918` (`IDLE_STAGES`).
 *
 * Đổi ở `core/history.ts` thì phải đổi ở đây. Danh sách này chỉ dùng để vẽ
 * trạng thái trống trước khi lượt chạy đầu tiên phát khung `run` — một khi
 * server đã gửi `run.stages` thì tên thật luôn thắng.
 */
export const WORKFLOW_IDLE_STAGES = [
  'Đọc và xác thực tài liệu',
  'AI phân tích yêu cầu, màn hình và element',
  'Cập nhật element registry',
  'Sinh bộ testcase',
  'Chuẩn hoá và bind step',
  'Chờ duyệt / chỉnh sửa testcase',
  'Chuẩn bị môi trường automation',
  'Chạy các kịch bản đã duyệt',
  'Healing và chạy lại lỗi locator',
  'Sinh report, ảnh và video',
  'Hoàn tất workflow',
] as const;

/** Bốn stage của một lượt Device Farm — `core/history.ts:166`. */
export const FARM_IDLE_STAGES = [
  'Đóng gói test package',
  'Upload app + package lên Device Farm',
  'Chờ Device Farm chạy',
  'Thu artifact',
] as const;

/** Nhãn tiếng Việt cho `WorkflowRun['status']` — giữ nguyên chữ ở app.js:1963. */
export const RUN_STATUS_LABELS: Record<string, string> = {
  waiting_review: 'Chờ duyệt',
  waiting_input: 'Chờ bổ sung thông tin',
  running: 'Đang chạy',
  passed: 'Hoàn tất',
  failed: 'Có lỗi',
};

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status;
}
