import { http, HttpResponse } from 'msw';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { sse } from '../sse';

/**
 * Ba route của Workflow Gate.
 *
 * `answers` trả `remaining: 0` mặc định — test nào cần nhánh "còn thiếu câu"
 * thì `server.use()` đè lại, vì đó là hai thông điệp khác hẳn nhau trên UI.
 */
export const workflowHandlers = [
  http.get(ROUTES.workflowQuestions, () =>
    HttpResponse.json({ status: 'waiting_input', questions: [], pending: 0 }),
  ),
  http.post(ROUTES.workflowAnswers, () =>
    HttpResponse.json({ remaining: 0, status: 'running' }),
  ),
  http.post(STREAM_ROUTES.workflowComplete, () =>
    sse([
      ['log', 'Đang chuẩn bị chạy các testcase đã duyệt…'],
      [
        'run',
        {
          id: 'wf-1',
          kind: 'workflow',
          feature: 'Đăng nhập',
          status: 'running',
          startedAt: '2026-08-27T09:00:00.000Z',
          log: [],
          stages: [
            { name: 'Chờ duyệt / chỉnh sửa testcase', status: 'done' },
            { name: 'Chuẩn bị môi trường automation', status: 'running' },
          ],
        },
      ],
      ['log', '✓ Đã chạy 2 testcase.'],
      ['done', { ok: true }],
    ]),
  ),
];
