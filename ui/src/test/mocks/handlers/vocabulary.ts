import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';
import type { VocabularyResponse } from '@core/ui/contracts.js';

export const vocabularyHandlers = [
  http.get(ROUTES.vocabulary, () =>
    HttpResponse.json<VocabularyResponse>({
      forms: [
        {
          id: 'tap',
          group: 'Thao tác',
          doc: 'I tap "<element>"',
          hint: 'Bấm vào một nút hoặc một dòng.',
        },
      ],
      actions: [],
      elements: [{ id: 'login.submit', label: 'Nút đăng nhập', screen: 'login' }],
    }),
  ),
];
