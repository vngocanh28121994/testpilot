import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';

export const settingsHandlers = [
  // Token đã lưu KHÔNG BAO GIỜ quay lại trình duyệt — chỉ có cờ (server.ts:198).
  http.get(ROUTES.confluenceAuth, () =>
    HttpResponse.json({ email: 'qa@example.com', hasToken: true }),
  ),
  http.post(ROUTES.confluenceAuth, () => HttpResponse.json({ ok: true })),
  http.post(ROUTES.mcpTools, () =>
    HttpResponse.json({
      tools: [{ name: 'confluence_get_page' }, { name: 'figma_get_file' }],
      guess: { confluencePage: 'confluence_get_page', figmaFile: 'figma_get_file' },
    }),
  ),
];
