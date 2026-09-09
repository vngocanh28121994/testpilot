import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import type { ActiveRunsResponse } from '@core/ui/contracts.js';

/**
 * Lượt chạy nào đang sống ở server.
 *
 * Trang hỏi câu này lúc mở lên. Không có nó thì một lượt chạy vẫn đang bấm vào
 * thiết bị thật trở nên vô hình sau mỗi lần tải lại — job store nằm trong RAM
 * của trang, nên reload là mất sạch, trong khi tiến trình ở server vẫn chạy.
 */
export function useActiveRuns() {
  return useQuery({
    queryKey: ['run-active'],
    queryFn: () => api.get<ActiveRunsResponse>(ROUTES.runActive),
    // Hỏi lại đều đặn: một lượt chạy có thể bắt đầu hoặc kết thúc ở tab khác.
    refetchInterval: 5_000,
  });
}
