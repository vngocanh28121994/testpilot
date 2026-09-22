import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';
import { healingFixture } from '../fixtures';

export const healingHandlers = [
  http.get(ROUTES.healing, () => HttpResponse.json(healingFixture)),
  http.post(ROUTES.healingReview, () => HttpResponse.json({ ok: true })),
  // Hàng chờ duyệt mặc định RỖNG: phần lớn những gì runner học được được nhận
  // thẳng, nên trang này ngắn theo thiết kế. Bài nào cần đề xuất thì tự đặt
  // handler riêng — và như thế nó nói rõ mình đang dựng cảnh gì.
  http.get(ROUTES.proposals, () => HttpResponse.json({ proposals: [] })),
  http.post(ROUTES.proposalReview, () => HttpResponse.json({ ok: true })),
];
