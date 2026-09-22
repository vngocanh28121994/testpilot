import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';

/**
 * Sổ máy chạy test, mặc định RỖNG.
 *
 * Rỗng chứ không phải một máy mẫu: bảng này có bốn trạng thái nhìn khác nhau
 * (sẵn sàng, thiếu gì đó, chưa đo, đang tắt), và một máy mẫu dùng chung sẽ
 * khiến mỗi bài phải nhớ mình đang thừa hưởng cái gì. Bài nào cần máy thì tự
 * dựng cảnh của mình.
 */
export const runnerHandlers = [
  http.get(ROUTES.runners, () => HttpResponse.json({ runners: [] })),
];
