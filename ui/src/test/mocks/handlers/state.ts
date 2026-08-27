import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';
import { stateFixture } from '../fixtures';

export const stateHandlers = [
  http.get(ROUTES.state, () => HttpResponse.json(stateFixture)),
  http.get(ROUTES.history, () => HttpResponse.json({ runs: stateFixture.runs })),
];
