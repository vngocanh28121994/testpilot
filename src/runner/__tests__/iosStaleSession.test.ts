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
/** Phiên Appium còn sống nhưng WDA trên máy đã tắt: lệnh nào cũng 500 "Could not proxy". */
const wdaDead = new Set<string>();
const deleted: string[] = [];
const actionsOn: string[] = [];

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
      if (id && req.method === 'DELETE') { deleted.push(id); return reply(res, 200, null); }
      if (id && url.endsWith('/actions')) {
        if (wdaDead.has(id)) {
          return reply(res, 500, {
            error: 'unknown error',
            message: 'Could not proxy command to the remote server. Original error: socket hang up',
          });
        }
        actionsOn.push(id);
      }
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

  /**
   * Khởi động lại TestPilot (nạp bản sửa) từng kéo theo mở lại WDA trên
   * iPhone — và iOS hỏi lại mật khẩu cho phép điều khiển tự động; không ai
   * nhập thì web "loading mãi". Phiên cũ còn sống thì phải dùng lại.
   */
  it('tiến trình mới, phiên cũ còn sống: dùng lại, KHÔNG mở WDA lần nữa', async () => {
    const { writeSessionRecord, screenSize } = await import('../iosControl.js');
    const udid = '00008101-DUNGLAI';
    await writeSessionRecord(udid, { id: 's-cu', mjpegPort: 9999 });
    const before = opened.length;
    const screen = await screenSize(udid);
    assert.equal(opened.length, before, 'không được mở phiên mới');
    assert.equal(screen.width, 428);
  });
});

/**
 * Lỗi thật trên màn Điều khiển: mở trình chuyển app, vuốt đóng thẻ
 * WebDriverAgentRunner. Phiên Appium còn sống, WDA trên máy thì không —
 * mọi cú chạm sau đó báo "socket hang up" mãi, bấm lại không ăn thua.
 */
describe('WebDriverAgent trên máy tắt giữa lúc điều khiển', () => {
  it('tự mở lại WDA rồi làm lại đúng cú chạm ấy một lần', async () => {
    const ios = await import('../iosControl.js');
    const udid = '00008140-VUOTDONG';
    await ios.screenSize(udid);
    const first = opened[opened.length - 1]!;
    wdaDead.add(first);

    await ios.tap(udid, 10, 20);

    const second = opened[opened.length - 1]!;
    assert.notEqual(second, first, 'phải mở phiên mới — Appium mở lại WDA');
    assert.ok(deleted.includes(first), 'phiên hỏng phải được đóng');
    assert.deepEqual(actionsOn.filter((id) => id === second).length, 1, 'cú chạm được làm lại đúng một lần');
  });

  it('WDA vẫn không mở lại được thì nói việc cần làm', async () => {
    const ios = await import('../iosControl.js');
    const udid = '00008140-KHONGLEN';
    await ios.screenSize(udid);
    // Mọi phiên từ đây đều có WDA chết.
    const original = opened.length;
    const kill = setInterval(() => { for (const id of opened.slice(original - 1)) wdaDead.add(id); }, 1);
    try {
      wdaDead.add(opened[opened.length - 1]!);
      await assert.rejects(ios.tap(udid, 1, 1), /Nhả máy rồi Giữ máy lại/);
    } finally {
      clearInterval(kill);
    }
  });

  it('nhận ra đúng các câu báo WDA đã tắt', async () => {
    const { wdaGone } = await import('../iosControl.js');
    assert.ok(wdaGone('Could not proxy command to the remote server. Original error: socket hang up'));
    assert.ok(wdaGone('Connection was refused to port 60996'));
    assert.ok(!wdaGone('An element could not be located on the page'));
  });
});
