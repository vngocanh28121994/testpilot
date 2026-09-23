/**
 * Chọn kho phiên theo chế độ.
 *
 * Bài đáng giá nhất ở đây là lần TỪ CHỐI: chế độ `server` mà thiếu DB thì
 * DỪNG, không lặng lẽ dùng RAM. Quay về RAM ở đó dựng ra một hệ thống đăng
 * nhập chạy được trên máy người deploy và hỏng ngay khi có instance thứ hai —
 * kiểu hỏng chỉ lộ ra dưới tải, tức là lúc tệ nhất. Cùng luật với `repoFactory`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sessionStore } from '../state.js';
import { MemorySessionStore, type SessionStore } from '../session.js';

describe('kho phiên theo chế độ', () => {
  it('embedded thì RAM, và không cần DB', () => {
    const store = sessionStore({ mode: 'embedded' });
    assert.ok(store instanceof MemorySessionStore);
    // Bản RAM KHÔNG khai `reapExpired`: nó tự quên khi tiến trình chết, và
    // vòng dọn nhìn vào chính điều đó để biết có việc gì phải làm không.
    assert.equal(store.reapExpired, undefined);
  });

  it('server mà thiếu DB thì ném, kèm câu nói rõ vì sao', () => {
    assert.throws(
      () => sessionStore({ mode: 'server' }),
      /TESTPILOT_DATABASE_URL/,
    );
  });

  it('server có DB thì hoãn mở kho tới lời gọi đầu tiên', async () => {
    let opened = 0;
    const built: SessionStore = new MemorySessionStore();
    const store = sessionStore({
      mode: 'server',
      pool: async () => { opened += 1; return {} as never; },
      build: () => built,
    });

    // `GET /api/health` và đường runner (token riêng, không qua phiên) phải
    // trả lời được khi DB còn chưa lên.
    assert.equal(opened, 0, 'dựng kho không được mở kết nối');

    await store.find('khong-co');
    assert.equal(opened, 1);
    await store.find('khong-co');
    assert.equal(opened, 1, 'mở đúng một lần cho cả tiến trình');
  });

  it('kho bên dưới không dọn được thì trả 0, không ném vào giữa vòng dọn', async () => {
    const store = sessionStore({
      mode: 'server',
      pool: async () => ({}) as never,
      build: () => new MemorySessionStore(),
    });
    assert.equal(await store.reapExpired!(), 0);
  });
});
