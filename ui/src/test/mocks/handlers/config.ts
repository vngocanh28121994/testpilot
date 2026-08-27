import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';
import { stateFixture } from '../fixtures';

export const configHandlers = [
  http.put(ROUTES.config, () => HttpResponse.json({ ok: true, config: stateFixture.config })),
  http.post(ROUTES.modelKey, () => HttpResponse.json({ ok: true })),
];
