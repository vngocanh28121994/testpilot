import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';
import { stateFixture } from '../fixtures';

export const configHandlers = [
  http.put(ROUTES.config, () => HttpResponse.json({ ok: true, config: stateFixture.config })),
  http.post(ROUTES.modelKey, () => HttpResponse.json({ ok: true })),
  http.get(ROUTES.models, () => HttpResponse.json({ models: [{ id: 'claude-sonnet', display_name: 'Claude Sonnet' }], live: false, reason: 'Không kết nối nhà cung cấp', auto: 'claude-sonnet' })),
];
