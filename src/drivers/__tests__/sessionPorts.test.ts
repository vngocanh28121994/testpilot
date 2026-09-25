/**
 * Cổng của phiên Appium khi nhiều lượt chạy song song trên một máy tính.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { portFree, sessionPort } from '../sessionPorts.js';

const busy = async () => false;
const free = async () => true;
const next = async () => 55_123;

describe('sessionPort', () => {
  it('cổng khai trong config mà rảnh thì dùng đúng nó', async () => {
    assert.deepEqual(await sessionPort('ios', 8101, { portFree: free, freePort: next }), { port: 8101 });
    assert.deepEqual(await sessionPort('android', 8201, { portFree: free, freePort: next }), { port: 8201 });
  });

  it('cổng khai trong config mà bận thì đổi sang cổng rảnh, và nói ra', async () => {
    assert.deepEqual(
      await sessionPort('ios', 8101, { portFree: busy, freePort: next }),
      { port: 55_123, moved: { from: 8101, to: 55_123 } },
    );
  });

  it('Android không khai cổng thì để UiAutomator2 tự chọn', async () => {
    assert.deepEqual(await sessionPort('android', undefined, { portFree: free, freePort: next }), {});
  });

  it('iPhone không khai cổng thì lấy cổng rảnh — mặc định 8100 là cố định', async () => {
    assert.deepEqual(await sessionPort('ios', undefined, { portFree: free, freePort: next }), { port: 55_123 });
  });

  it('simulator giữ nguyên hành vi cũ, kể cả khi cổng đang bận', async () => {
    assert.deepEqual(await sessionPort('ios', 8100, { simulator: true, portFree: busy, freePort: next }), { port: 8100 });
    assert.deepEqual(await sessionPort('ios', undefined, { simulator: true, portFree: busy, freePort: next }), {});
  });

  it('portFree nhận ra cổng đang có tiến trình nghe', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;
    try {
      assert.equal(await portFree(port), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    assert.equal(await portFree(port), true);
  });
});
