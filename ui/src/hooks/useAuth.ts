import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';

/**
 * Ai đang dùng trang này — và có cần đăng nhập không.
 *
 * Chế độ embedded (một người, một máy) trả `authenticated: true` luôn, nên
 * phần còn lại của giao diện không phải biết có hai chế độ.
 */
export interface AuthState {
  mode: 'embedded' | 'server';
  authenticated: boolean;
  identity: { userId: string; email?: string; role: string; orgId: string } | null;
}

export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

export function useAuth() {
  return useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => api.get<AuthState>(ROUTES.authMe),
    // Phiên không đổi theo từng giây; hỏi lại khi có một yêu cầu trả 401
    // (xem lib/queryClient.ts), không phải theo nhịp.
    staleTime: 60_000,
  });
}

/** Sang trang đăng nhập của máy chủ, rồi quay về đúng trang đang xem. */
export function goToLogin(): void {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`${ROUTES.authLogin}?returnTo=${encodeURIComponent(here)}`);
}

/**
 * Đăng xuất cả ở TestPilot lẫn ở nhà cung cấp đăng nhập.
 *
 * Chỉ xoá phiên của TestPilot thì lần bấm Đăng nhập sau tự vào lại đúng tài
 * khoản cũ (phiên SSO còn sống) — không đổi được sang tài khoản khác.
 */
export async function logout(): Promise<void> {
  const result = await api.post<{ ok: boolean; redirect?: string }>(ROUTES.authLogout)
    .catch(() => undefined);
  window.location.assign(result?.redirect ?? '/');
}
