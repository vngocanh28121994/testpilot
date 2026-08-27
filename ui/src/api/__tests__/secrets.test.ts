import { describe, expect, it } from 'vitest';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import type { StateResponse } from '@core/ui/contracts.js';

/**
 * R9 — bí mật không bao giờ đi qua dây.
 *
 * Server chỉ trả cờ `hasPassword`/`modelKeys`/`hasApiKey`, không bao giờ trả
 * giá trị (server.ts:820). Đây là bất biến bảo mật, không phải chi tiết cài
 * đặt: một lần ai đó "tiện tay" thêm `password` vào response để đỡ phải gọi
 * thêm một route là mật khẩu tài khoản test nằm trong devtools của trình duyệt.
 *
 * Test này canh phía client. Nếu fixture (vốn khai kiểu `StateResponse`) một
 * ngày mọc ra trường mật khẩu thì cả `tsc` lẫn test này đều phải đỏ.
 */
describe('bất biến bí mật (R9)', () => {
  const FORBIDDEN = ['password', 'apiKey', 'api_key', 'token', 'secret'];

  it('/api/state không trả về giá trị bí mật nào', async () => {
    const state = await api.get<StateResponse>(ROUTES.state);
    const flat = JSON.stringify(state).toLowerCase();

    for (const key of FORBIDDEN) {
      expect(flat, `response chứa khoá "${key}"`).not.toContain(`"${key}":`);
    }
    // Cái được phép có: cờ boolean.
    expect(state.accounts[0]).toHaveProperty('hasPassword');
    expect(typeof state.accounts[0]?.hasPassword).toBe('boolean');
    expect(state.modelKeys.anthropic).toBe(true);
  });
});
