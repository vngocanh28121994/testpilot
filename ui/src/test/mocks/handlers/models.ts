import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';
import type { ModelsResponse } from '@core/ui/contracts.js';

export const modelsHandlers = [
  http.get(ROUTES.models, () =>
    HttpResponse.json<ModelsResponse>({
      models: [
        { id: 'claude-opus-5', display_name: 'Claude Opus 5' },
        { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' },
      ],
      live: true,
      auto: 'claude-opus-5',
    }),
  ),
];
