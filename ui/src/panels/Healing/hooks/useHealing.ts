import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { HealingResponse, HealingReviewRequest } from '@core/ui/contracts.js';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';

export const healingQueryKey = ['healing'] as const;

export function useHealing() {
  return useQuery({
    queryKey: healingQueryKey,
    queryFn: () => api.get<HealingResponse>(ROUTES.healing),
  });
}

/**
 * Duyệt hoặc từ chối một đề xuất healing.
 *
 * `POST /api/healing/review` trả về TOÀN BỘ trạng thái healing mới, không phải
 * một bản ghi. Nên ghi thẳng vào cache thay vì invalidate rồi fetch lại: bản
 * cũ cũng làm vậy (`healingData = await api(...)` ở app.js:1236) và nó tiết
 * kiệm đúng một vòng round-trip ở thao tác người dùng bấm nhiều nhất.
 *
 * Vẫn phải invalidate `['state']`: áp dụng một locator ghi vào element
 * registry, mà số element hiện trên Dashboard đọc từ đó.
 */
export function useReviewHealing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: HealingReviewRequest) =>
      api.post<HealingResponse>(ROUTES.healingReview, body),

    onSuccess: (fresh, variables) => {
      queryClient.setQueryData(healingQueryKey, fresh);
      void queryClient.invalidateQueries({ queryKey: ['state'] });
      toast.success(
        variables.action === 'apply'
          ? 'Đã đưa locator được duyệt lên primary trong element registry.'
          : 'Đã từ chối đề xuất; locator hiện tại không bị thay đổi.',
      );
    },

    onError: (err: Error) => toast.error(err.message),
  });
}
