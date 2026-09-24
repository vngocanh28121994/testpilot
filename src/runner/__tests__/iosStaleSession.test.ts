/**
 * Giữ iPhone trên màn Điều khiển, chạy một lượt test trên cùng chiếc máy, rồi
 * giữ lại: màn hình báo "ECONNREFUSED" ở cổng MJPEG. Lượt test đã mở phiên
 * Appium riêng — Appium đóng phiên của màn điều khiển — còn tiến trình này vẫn
 * nhớ phiên cũ và dùng lại nó.
 *
 * Appium ở đây là giả: đủ để đếm số phiên được mở và làm một phiên "chết".
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

let server: Server;
const opened: string[] = [];
const dead = new Set<string>();

function reply(res: import('node:http').ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ value }));
}

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = req.url ?? '';
      if (req.method === 'POST' && url === '/session') {
        const id = `s${opened.length + 1}`;
        opened.push(id);
        return reply(res, 200, { sessionId: id });
      }
      const id = /^\/session\/([^/]+)/.exec(url)?.[1];
      if (id && dead.has(id)) return reply(res, 404, { error: 'invalid session id', message: 'gone' });
      if (url.endsWith('/window/rect')) return reply(res, 200, { width: 428, height: 926 });
      return reply(res, 200, null);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  process.env.TESTPILOT_APPIUM_PORT = String(typeof address === 'object' && address ? address.port : 0);
  // Sổ phiên ghi theo thư mục làm việc — đừng ghi vào repo.
  process.chdir(await mkdtemp(path.join(tmpdir(), 'tp-stale-')));
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('phiên điều khiển iOS đã chết thì mở phiên mới', () => {
  it('giữ lại sau khi phiên cũ bị đóng', async () => {
    const ios = await import('../iosControl.js');
    const udid = '00008101-00096DA21EF1001E';

    await ios.screenSize(udid);
    await ios.screenSize(udid);
    assert.deepEqual(opened, ['s1'], 'phiên còn sống thì dùng lại, không mở thêm');

    dead.add('s1'); // một lượt test vừa chiếm máy
    await ios.screenSize(udid);
    assert.deepEqual(opened, ['s1', 's2'], 'phiên chết thì mở phiên mới');
  });
});
