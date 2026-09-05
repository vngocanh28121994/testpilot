import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';
import type { PreflightResponse } from '@core/ui/contracts.js';

/**
 * Mặc định: web không cần gì, android sẵn sàng với đúng một máy.
 *
 * Test nào cần nhiều máy hay một lần dò hỏng thì `server.use()` đè lên.
 */
export const preflightHandlers = [
  http.get(ROUTES.preflight, ({ request }) => {
    const platform = new URL(request.url).searchParams.get('platform') ?? 'web';
    return HttpResponse.json<PreflightResponse>({
      platform: platform as PreflightResponse['platform'],
      ok: true,
      checks: [{ name: 'Thiết bị', ok: true, detail: 'pixel-7 (emulator-5554)' }],
    });
  }),
];
