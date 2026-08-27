import { useQuery } from '@tanstack/react-query';
import type { StateResponse } from '@core/ui/contracts.js';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';

/**
 * `GET /api/state` trả về MƯỜI HAI nhóm dữ liệu trong một response, và
 * `refresh()` của app cũ vẽ lại 6 panel mỗi lần gọi (app.js:344).
 *
 * Bê thẳng vào Query sẽ cho một `['state']` mà mọi mutation đều phải
 * invalidate và mọi panel đều re-render — đúng vấn đề của app cũ, chỉ khác là
 * giờ tốn thêm một lượt reconcile. Xem UI-MIGRATION-PLAN §6.7.
 *
 * Cách dùng: panel đọc LÁT CẮT của mình qua `select`. React Query so sánh kết
 * quả sau select, và `structuralSharing` (mặc định) giữ nguyên tham chiếu cho
 * nhánh không đổi — nên một panel chỉ render lại khi đúng lát cắt của nó đổi.
 *
 * Đừng tách /api/state thành nhiều endpoint ở backend: ngoài phạm vi đợt này.
 * Route nào đã có endpoint riêng (/api/healing, /api/history, /api/builds…)
 * thì dùng query key riêng, KHÔNG đọc ké từ ['state'].
 */
export const stateQueryKey = ['state'] as const;

export function useAppState<T>(select: (s: StateResponse) => T) {
  return useQuery({
    queryKey: stateQueryKey,
    queryFn: () => api.get<StateResponse>(ROUTES.state),
    select,
    staleTime: 5_000,
  });
}

export const useConfig = () => useAppState((s) => s.config);
export const useConfigError = () => useAppState((s) => s.configError);
export const useAccounts = () => useAppState((s) => s.accounts);
export const useAppBuilds = () => useAppState((s) => s.appBuilds);
export const useEnvBuilds = () => useAppState((s) => s.envBuilds);
export const useModelKeys = () => useAppState((s) => s.modelKeys);
export const useRecentRuns = () => useAppState((s) => s.runs);
export const useTagTaxonomy = () => useAppState((s) => s.tagTaxonomy);
export const useElementCount = () => useAppState((s) => s.elements);
