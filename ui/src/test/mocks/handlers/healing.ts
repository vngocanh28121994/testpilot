import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';
import { healingFixture } from '../fixtures';

export const healingHandlers = [
  http.get(ROUTES.healing, () => HttpResponse.json(healingFixture)),
  http.post(ROUTES.healingReview, () => HttpResponse.json({ ok: true })),
];
