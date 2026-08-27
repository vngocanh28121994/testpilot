import { QueryClient } from '@tanstack/react-query';

/**
 * Khác `sen` ở hai điểm, cả hai đều có lý do (UI-MIGRATION-PLAN §Phase 2.5):
 *
 * 1. Không có nhánh 401. TestPilot chạy cục bộ, không đăng nhập — nút "Đăng
 *    xuất" của bản cũ chỉ gọi alert(). Giữ lại nhánh đó là code chết.
 * 2. Nhóm route chậm không retry. Một lệnh gọi AWS Device Farm hỏng mất ~30
 *    giây để hỏng; thử lại hai lần nữa là bắt người dùng chờ 90 giây để nhận
 *    đúng một thông báo lỗi. Với những route này, hỏng nhanh là tính năng.
 */
const NO_RETRY_PREFIXES = ['/api/aws', '/api/prereq', '/api/farm'];

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const path = (error as { path?: string }).path ?? '';
        if (NO_RETRY_PREFIXES.some((p) => path.startsWith(p))) return false;
        return failureCount < 2;
      },
      staleTime: 5_000,
    },
    mutations: { retry: false },
  },
});
