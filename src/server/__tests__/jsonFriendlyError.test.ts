/**
 * Mọi `{ error }` trả về giao diện đi qua `json()` — kể cả lỗi ném ra từ một
 * route quên try/catch. Dịch ở đúng cửa này là lý do gần trăm route không phải
 * nhớ tự dịch.
 */
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import { json } from '../http.js';

function capture() {
  let body = '';
  const res = {
    writeHead: () => res,
    end: (chunk: string) => { body = chunk; },
  } as unknown as ServerResponse;
  return { res, body: () => JSON.parse(body) as Record<string, unknown> };
}

describe('json(): lỗi đi ra đã thân thiện', () => {
  it('lỗi kỹ thuật được dịch, nguyên văn vẫn còn', () => {
    const out = capture();
    json(out.res, 502, { error: 'connect ECONNREFUSED 127.0.0.1:4723' });
    assert.match(String(out.body().error), /^Appium chưa chạy.*Chi tiết kỹ thuật: connect ECONNREFUSED/);
  });

  it('các trường khác giữ nguyên (issues của zod)', () => {
    const out = capture();
    json(out.res, 400, { error: 'Config không hợp lệ', issues: ['a: sai'] });
    assert.deepEqual(out.body(), { error: 'Config không hợp lệ', issues: ['a: sai'] });
  });

  it('phản hồi thành công không bị đụng tới', () => {
    const out = capture();
    json(out.res, 200, { error: 'forbidden' });
    assert.equal(out.body().error, 'forbidden');
  });
});
