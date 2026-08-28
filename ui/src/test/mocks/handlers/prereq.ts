import { http, HttpResponse } from 'msw';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { sse } from '../sse';

/**
 * Route stream. Trả khung SSE thật — xem ../sse.ts để biết vì sao điều đó
 * không thể rút gọn thành JSON.
 */
export const prereqHandlers = [
  http.get(ROUTES.prereqAppiumStatus, () => HttpResponse.json({ running: false, managed: false })),
  http.get(ROUTES.prereqAdb, () => HttpResponse.json({ devices: [] })),
  http.get(ROUTES.prereqXcode, () => HttpResponse.json({ ok: true, version: 'Xcode 16.0', path: '/Applications/Xcode.app', sdk: 'iphoneos18.0' })),
  http.get(ROUTES.prereqIosDevices, () => HttpResponse.json({ devices: [], attached: [] })),
  http.post(STREAM_ROUTES.prereqAppium, () =>
    sse([
      ['log', 'Đang khởi động Appium…'],
      ['log', '✓ Appium sẵn sàng.'],
      ['done', { ok: true }],
    ]),
  ),
  http.post(STREAM_ROUTES.prereqAppiumRestart, () => sse([['done', { ok: true }]])),
  http.post(STREAM_ROUTES.prereqDriver, () =>
    sse([
      ['log', '✓ Driver đã sẵn sàng.'],
      ['done', { ok: true }],
    ]),
  ),
];
