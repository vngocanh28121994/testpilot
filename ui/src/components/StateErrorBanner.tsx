import { useQuery } from '@tanstack/react-query';
import type { StateResponse } from '@core/ui/contracts.js';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { stateQueryKey } from '@/hooks/useAppState';

/**
 * Nói ra khi `/api/state` đang hỏng, ở mọi màn hình.
 *
 * React Query giữ lại dữ liệu của lần gọi cuối cùng thành công, nên khi endpoint
 * bắt đầu lỗi thì panel vẫn có `data` và vẫn vẽ ra bình thường — chỉ là vẽ bằng
 * số liệu cũ, hoặc rỗng. Người dùng thấy một màn hình trông như đang chạy tốt.
 *
 * Đo ngày 2026-09-16: một element sinh mới lấy trùng tên alias của element khác
 * làm `Registry.load()` ném, `/api/state` và `/api/healing` cùng trả 500. Màn
 * Kịch bản hiện "0 kịch bản khớp bộ lọc" — câu chữ của một bộ lọc quá hẹp — nên
 * người dùng đi soi bộ lọc, trong khi thứ hỏng là server. Nhánh báo lỗi của
 * panel có tồn tại, nhưng nó chỉ chạy khi `!state.data`, mà data cũ thì vẫn còn.
 *
 * Đặt ở AppShell để mọi màn hình thừa hưởng, thay vì sửa empty-state của từng
 * panel: "0 kết quả" là câu trả lời hợp lệ của mỗi panel, còn "server đang
 * hỏng" là chuyện của cả trang.
 */
export function StateErrorBanner() {
  const { isError, error } = useQuery({
    queryKey: stateQueryKey,
    queryFn: () => api.get<StateResponse>(ROUTES.state),
    staleTime: 5_000,
  });
  if (!isError) return null;
  return (
    <div
      role="alert"
      data-state-error
      className="border-status-fail/40 bg-(--tint-fail) mb-4 rounded-lg border border-s-[3px] p-4 text-sm"
    >
      <b>Máy chủ đang lỗi — số liệu trên màn hình có thể cũ hoặc thiếu</b>
      <p className="text-muted-foreground mt-1">
        Mọi con số và danh sách dưới đây đọc từ <code>{ROUTES.state}</code>, và lệnh gọi đó
        đang hỏng. Màn hình trống ở đây nghĩa là chưa đọc được dữ liệu, KHÔNG phải là không
        có dữ liệu.
      </p>
      <code className="mt-2 block overflow-x-auto rounded bg-black/5 p-2 dark:bg-white/5">
        {(error as Error).message}
      </code>
    </div>
  );
}
