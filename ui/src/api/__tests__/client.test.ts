import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import { api, ApiRequestError, qs } from '@/api/client';

describe('api client', () => {
  it('trả về dữ liệu khi 200', async () => {
    server.use(http.get('/api/thu', () => HttpResponse.json({ a: 1 })));
    await expect(api.get<{ a: number }>('/api/thu')).resolves.toEqual({ a: 1 });
  });

  /**
   * Nhánh dễ mất nhất khi viết lại tầng API.
   *
   * `PUT /api/config` trả mảng `issues` từ zod và đó là thứ DUY NHẤT chỉ ra
   * trường nào sai. Rút gọn xuống `data.error` là biến một danh sách sửa được
   * thành "Config không hợp lệ" — xem app.js:335 và UI-MIGRATION-PLAN §Phase 2.3.
   */
  it('ưu tiên `issues` hơn `error` và nối bằng xuống dòng', async () => {
    server.use(
      http.put('/api/thu', () =>
        HttpResponse.json(
          { error: 'Config không hợp lệ', issues: ['web.baseUrl: phải là URL', 'accounts: rỗng'] },
          { status: 400 },
        ),
      ),
    );
    const err = await api.put('/api/thu', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    const e = err as ApiRequestError;
    expect(e.message).toBe('web.baseUrl: phải là URL\naccounts: rỗng');
    expect(e.issues).toHaveLength(2);
    expect(e.status).toBe(400);
    expect(e.path).toBe('/api/thu');
  });

  it('dùng `error` khi không có `issues`', async () => {
    server.use(http.get('/api/thu', () => HttpResponse.json({ error: 'Hỏng rồi' }, { status: 500 })));
    await expect(api.get('/api/thu')).rejects.toThrow('Hỏng rồi');
  });

  it('lùi về statusText khi body không phải JSON', async () => {
    server.use(http.get('/api/thu', () => new HttpResponse('bang!', { status: 502 })));
    const e = (await api.get('/api/thu').catch((x: unknown) => x)) as ApiRequestError;
    // Không được ném "Unexpected token" của JSON.parse — đó là lỗi của client,
    // không phải của server, và nó che mất status thật.
    expect(e).toBeInstanceOf(ApiRequestError);
    expect(e.status).toBe(502);
  });

  it('qs() bỏ qua khoá undefined', () => {
    expect(qs({ a: '1', b: undefined, c: 2 })).toBe('?a=1&c=2');
    expect(qs({})).toBe('');
  });
});
