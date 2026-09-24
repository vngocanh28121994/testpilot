import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

/**
 * Khác `sen` ở hai điểm, cả hai đều có lý do (UI-MIGRATION-PLAN §Phase 2.5):
 *
 * 1. Nhánh 401 KHÔNG đăng xuất hay chuyển trang tại chỗ: nó chỉ hỏi lại
 *    "tôi là ai" (`/api/auth/me`), và AuthGate tự đổi sang màn đăng nhập khi
 *    phiên thật sự đã hết. Ở chế độ embedded không bao giờ có 401.
 * 2. Nhóm route chậm không retry. Một lệnh gọi AWS Device Farm hỏng mất ~30
 *    giây để hỏng; thử lại hai lần nữa là bắt người dùng chờ 90 giây để nhận
 *    đúng một thông báo lỗi. Với những route này, hỏng nhanh là tính năng.
 */
const NO_RETRY_PREFIXES = ['/api/aws', '/api/prereq', '/api/farm'];

/** Phiên hết hạn giữa chừng: hỏi lại danh tính, để AuthGate hiện màn đăng nhập. */
function onUnauthorized(error: unknown): void {
  const status = (error as { status?: number }).status;
  const path = (error as { path?: string }).path ?? '';
  // Chính câu hỏi "tôi là ai" không bao giờ trả 401; loại nó ra để khỏi vòng lặp.
  if (status === 401 && path !== '/api/auth/me') {
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({ onError: onUnauthorized }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Chưa đăng nhập thì thử lại cũng vậy.
        if ((error as { status?: number }).status === 401) return false;
        const path = (error as { path?: string }).path ?? '';
        if (NO_RETRY_PREFIXES.some((p) => path.startsWith(p))) return false;
        return failureCount < 2;
      },
      staleTime: 5_000,
    },
    mutations: { retry: false },
  },
});
