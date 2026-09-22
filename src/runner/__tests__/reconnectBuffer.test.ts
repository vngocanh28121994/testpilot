/**
 * Mất mạng hai phút, không mất một dòng log nào.
 *
 * Đây là điều kiện hoàn thành của P3.4, và nó đáng một file riêng vì nó là thứ
 * duy nhất phân biệt một đường dây TIN ĐƯỢC với một đường dây trông có vẻ
 * chạy. Log là thứ duy nhất nói vì sao một lượt chạy đỏ; mất nó thì lượt chạy
 * ấy phải làm lại từ đầu.
 *
 * `fetch` được tiêm, nên hai phút mất mạng ở đây tốn vài mili giây.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteJobQueue } from '../remote.js';

/** Server giả: ghi lại những gì nhận được, và bật/tắt được như rút dây mạng. */
function fakeServer() {
  const stored = new Map<string, Map<number, string>>();
  let online = true;
  let calls = 0;

  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    if (!online) throw new Error('fetch failed: mạng đứt');
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      jobId?: string; events?: Array<{ seq: number; line: string }>;
    };
    const lines = stored.get(body.jobId ?? '') ?? new Map<number, string>();
    let ack = 0;
    for (const event of body.events ?? []) {
      // Khoá chính `(job_id, seq)`: ghi lại cùng seq là vô hại.
      lines.set(event.seq, event.line);
      if (event.seq > ack) ack = event.seq;
    }
    stored.set(body.jobId ?? '', lines);
    return new Response(JSON.stringify({ ack }), { status: 200 });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    stored,
    calls: () => calls,
    unplug: () => { online = false; },
    plugBack: () => { online = true; },
    linesOf: (jobId: string) =>
      [...(stored.get(jobId) ?? new Map<number, string>()).entries()]
        .sort(([a], [b]) => a - b)
        .map(([, line]) => line),
  };
}

function remote(fetchImpl: typeof fetch, maxBuffered?: number) {
  return new RemoteJobQueue({
    serverUrl: 'http://server.test',
    token: 'bi-mat',
    name: 'lab-01',
    fetchImpl,
    ...(maxBuffered !== undefined ? { maxBuffered } : {}),
  });
}

describe('đệm log của runner', () => {
  it('đường bình thường: gửi theo lô rồi quên', async () => {
    const server = fakeServer();
    const queue = remote(server.fetchImpl);

    await queue.appendLog('job-1', 'một');
    await queue.appendLog('job-1', 'hai');
    assert.equal(queue.waiting(), 2, 'chưa đẩy thì còn nằm trong đệm');

    assert.equal(await queue.flush(), 0);
    assert.deepEqual(server.linesOf('job-1'), ['một', 'hai']);
  });

  /**
   * Hai phút mất mạng. Runner vẫn in log — lượt chạy trên máy không dừng lại
   * vì server không với tới được — và mọi dòng phải tới nơi sau khi nối lại,
   * ĐÚNG THỨ TỰ.
   */
  it('rút mạng hai phút thì không mất dòng nào', async () => {
    const server = fakeServer();
    const queue = remote(server.fetchImpl);

    await queue.appendLog('job-1', 'trước khi đứt');
    await queue.flush();

    server.unplug();
    // Hai phút, nhịp đẩy nửa giây: 240 lần thử, mỗi lần vài dòng mới.
    for (let tick = 0; tick < 240; tick += 1) {
      await queue.appendLog('job-1', `dòng ${tick}`);
      await queue.flush();
    }
    assert.equal(queue.waiting(), 240, 'mất mạng thì đệm phải giữ lại');

    server.plugBack();
    assert.equal(await queue.flush(), 0);

    const lines = server.linesOf('job-1');
    assert.equal(lines.length, 241);
    assert.equal(lines[0], 'trước khi đứt');
    assert.equal(lines[1], 'dòng 0');
    assert.equal(lines.at(-1), 'dòng 239');
  });

  /**
   * Server nhận được một nửa lô rồi đứt: phần CHƯA xác nhận phải ở lại.
   *
   * Đây là chỗ "gửi rồi quên" hỏng mà không ai thấy — nửa lô kia biến mất, và
   * log có một khoảng trống không ai giải thích được.
   */
  it('chỉ quên phần đã được xác nhận', async () => {
    const stored: string[] = [];
    let acceptUpTo = 2;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        events?: Array<{ seq: number; line: string }>;
      };
      let ack = 0;
      for (const event of body.events ?? []) {
        if (event.seq > acceptUpTo) break;
        stored.push(event.line);
        ack = event.seq;
      }
      return new Response(JSON.stringify({ ack }), { status: 200 });
    }) as unknown as typeof fetch;

    const queue = remote(fetchImpl);
    for (const line of ['a', 'b', 'c', 'd']) await queue.appendLog('job-1', line);

    assert.equal(await queue.flush(), 2, 'hai dòng chưa được xác nhận phải ở lại');
    assert.deepEqual(stored, ['a', 'b']);

    acceptUpTo = 99;
    assert.equal(await queue.flush(), 0);
    assert.deepEqual(stored, ['a', 'b', 'c', 'd'], 'và chúng tới nơi đúng thứ tự');
  });

  /**
   * Đệm không vô hạn. Nhưng khi buộc phải bỏ, người đọc PHẢI biết là đã bỏ —
   * một khoảng trống im lặng trong log là thứ khiến người ta đi tìm lỗi ở chỗ
   * không có lỗi.
   */
  it('đệm đầy thì bỏ phần cũ và NÓI RA', async () => {
    const server = fakeServer();
    const queue = remote(server.fetchImpl, 10);

    server.unplug();
    for (let i = 0; i < 25; i += 1) await queue.appendLog('job-1', `dòng ${i}`);
    server.plugBack();
    await queue.flush();

    const lines = server.linesOf('job-1');
    assert.match(lines[0]!, /mất 15 dòng/);
    assert.equal(lines[1], 'dòng 15', 'phần còn lại là phần MỚI nhất');
    assert.equal(lines.at(-1), 'dòng 24');
  });

  it('gửi lại phần chưa xác nhận là vô hại, không nhân đôi', async () => {
    const server = fakeServer();
    const queue = remote(server.fetchImpl);

    await queue.appendLog('job-1', 'một');
    await queue.flush();
    // Giả lập một lần gửi lại: cùng nội dung, cùng seq.
    await queue.appendLog('job-1', 'hai');
    await queue.flush();
    await queue.flush();

    assert.deepEqual(server.linesOf('job-1'), ['một', 'hai']);
  });

  /** Báo job xong mà log chưa tới nơi thì giao diện thấy kết thúc trước lý do. */
  it('báo kết quả thì đẩy nốt log trước', async () => {
    const server = fakeServer();
    const queue = remote(server.fetchImpl);
    await queue.appendLog('job-1', 'dòng cuối trước khi hỏng');

    await queue.finish('job-1', { type: 'job.result', jobId: 'job-1', state: 'failed' });

    assert.deepEqual(server.linesOf('job-1'), ['dòng cuối trước khi hỏng']);
  });

  /** Runner chỉ biết job nó đang giữ; đọc hàng đợi là việc của control plane. */
  it('không giả vờ đọc được hàng đợi', async () => {
    const queue = remote(fakeServer().fetchImpl);
    await assert.rejects(() => queue.list(), /việc của control plane/);
    await assert.rejects(() => queue.find('x'), /việc của control plane/);
    await assert.rejects(() => queue.interruptStale(), /việc của control plane/);
  });
});
