import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProposalReviewRequest, ProposalsResponse } from '@core/ui/contracts.js';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';

export const proposalsQueryKey = ['proposals'] as const;

/**
 * Hàng chờ duyệt của registry.
 *
 * Mặc định chỉ lấy `pending`. Lịch sử duyệt là một câu hỏi khác — "ai đã đồng
 * ý cái gì" — và trộn nó vào đây nghĩa là hàng chờ dài ra mãi trong khi phần
 * cần làm hôm nay bị đẩy xuống dưới.
 */
export function useProposals() {
  return useQuery({
    queryKey: proposalsQueryKey,
    queryFn: () => api.get<ProposalsResponse>(ROUTES.proposals),
  });
}

/**
 * Đồng ý hoặc từ chối.
 *
 * Đồng ý là một lệnh GHI vào registry, nên phải làm mới cả `['state']` (số
 * element trên Dashboard đọc từ đó) và `['healing']` (primary hiện tại trong
 * bảng healing vừa đổi). Không làm mới thì màn hình nói một đằng còn dữ liệu
 * một nẻo, và người dùng sẽ bấm lại lần nữa.
 */
export function useReviewProposal() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: ProposalReviewRequest) => api.post<unknown>(ROUTES.proposalReview, body),
    onSuccess: (_result, variables) => {
      void client.invalidateQueries({ queryKey: proposalsQueryKey });
      void client.invalidateQueries({ queryKey: ['state'] });
      void client.invalidateQueries({ queryKey: ['healing'] });
      toast.success(
        variables.decision === 'accept'
          ? 'Đã áp dụng đề xuất vào registry dùng chung.'
          : 'Đã từ chối đề xuất; registry không thay đổi.',
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
