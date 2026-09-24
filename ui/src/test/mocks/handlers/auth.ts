import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';

/** Mặc định: chế độ embedded — không đăng nhập, như bản chạy một mình. */
export const authHandlers = [
  http.get(ROUTES.authMe, () =>
    HttpResponse.json({ mode: 'embedded', authenticated: true, identity: null })),
];
