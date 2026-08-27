import { http } from 'msw';
import { STREAM_ROUTES } from '@/api/routes';
import { sse } from '../sse';

/**
 * Route stream. Trả khung SSE thật — xem ../sse.ts để biết vì sao điều đó
 * không thể rút gọn thành JSON.
 */
export const prereqHandlers = [
  http.post(STREAM_ROUTES.prereqAppium, () =>
    sse([
      ['log', 'Đang khởi động Appium…'],
      ['log', '✓ Appium sẵn sàng.'],
      ['done', { ok: true }],
    ]),
  ),
  http.post(STREAM_ROUTES.prereqAppiumRestart, () => sse([['done', { ok: true }]])),
];
