/**
 * Tự khởi động lại tunnel khi iPhone cắm cáp mà tunnel không giữ.
 *
 * Kiểu hỏng thật: iPhone 16 Pro Max rớt USB một nhịp, sổ tunnel về 0 máy và
 * ở nguyên đó; màn Điều khiển báo "Unknown device or simulator UDID". Mỗi
 * chốt chặn dưới đây là một cách vòng tự chữa có thể gây hại nếu thiếu.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COOLDOWN_MS,
  MAX_ATTEMPTS,
  newTunnelWatchState,
  tunnelWatchTick,
  type TunnelWatchDeps,
} from '../tunnelWatch.js';

function world(opts: Omit<Partial<TunnelWatchDeps>, 'registry'> & { registry?: string[] | undefined } = {}) {
  const { registry: held, ...over } = opts;
  let clock = 0;
  const logs: string[] = [];
  let restarts = 0;
  const deps: TunnelWatchDeps = {
    serviceInstalled: () => true,
    wired: async () => ['IPHONE-16'],
    registry: async () => ('registry' in opts ? held : []),
    busy: async () => false,
    restart: async () => { restarts += 1; return { ok: true }; },
    log: (line) => logs.push(line),
    now: () => clock,
    ...over,
  };
  return {
    deps,
    logs,
    restarts: () => restarts,
    advance: (ms: number) => { clock += ms; },
  };
}

describe('tunnelWatchTick', () => {
  it('thiếu hai nhịp liên tiếp thì khởi động lại — một nhịp thì chờ tunnel tự nối', async () => {
    const w = world();
    const state = newTunnelWatchState();
    assert.equal(await tunnelWatchTick(state, w.deps), 'waiting');
    assert.equal(w.restarts(), 0);
    assert.equal(await tunnelWatchTick(state, w.deps), 'restarted');
    assert.equal(w.restarts(), 1);
  });

  it('tunnel đã giữ đúng máy thì không làm gì', async () => {
    const w = world({ registry: ['IPHONE-16'] });
    const state = newTunnelWatchState();
    await tunnelWatchTick(state, w.deps);
    assert.equal(await tunnelWatchTick(state, w.deps), 'ok');
    assert.equal(w.restarts(), 0);
  });

  /** Khởi động lại tunnel làm đứt mọi phiên iOS đang chạy trên máy này. */
  it('có iPhone đang bận thì chờ, không giết lượt chạy đang dở', async () => {
    const w = world({ registry: ['IPHONE-12'], wired: async () => ['IPHONE-12', 'IPHONE-16'], busy: async () => true });
    const state = newTunnelWatchState();
    await tunnelWatchTick(state, w.deps);
    assert.equal(await tunnelWatchTick(state, w.deps), 'busy');
    assert.equal(w.restarts(), 0);
    assert.match(w.logs.join('\n'), /Chờ lượt iOS đang chạy xong/);
  });

  it('hỏi "bận" với cả máy tunnel đang giữ lẫn máy vừa cắm', async () => {
    let asked: string[] = [];
    const w = world({
      registry: ['IPHONE-12'],
      wired: async () => ['IPHONE-12', 'IPHONE-16'],
      busy: async (udids) => { asked = udids; return false; },
    });
    const state = newTunnelWatchState();
    await tunnelWatchTick(state, w.deps);
    await tunnelWatchTick(state, w.deps);
    assert.deepEqual(asked.sort(), ['IPHONE-12', 'IPHONE-16']);
  });

  it('không có dịch vụ tunnel thì không đụng vào — khởi động lại khi ấy cần mật khẩu', async () => {
    const w = world({ serviceInstalled: () => false });
    const state = newTunnelWatchState();
    await tunnelWatchTick(state, w.deps);
    assert.equal(await tunnelWatchTick(state, w.deps), 'no-service');
    assert.equal(w.restarts(), 0);
  });

  it('không đọc được sổ tunnel thì không kết luận gì', async () => {
    const w = world({ registry: undefined });
    const state = newTunnelWatchState();
    await tunnelWatchTick(state, w.deps);
    assert.equal(await tunnelWatchTick(state, w.deps), 'no-registry');
    assert.equal(w.restarts(), 0);
  });

  it('cách nhau ít nhất hai phút, và dừng sau ba lần cho cùng một máy', async () => {
    const w = world();
    const state = newTunnelWatchState();
    await tunnelWatchTick(state, w.deps);
    assert.equal(await tunnelWatchTick(state, w.deps), 'restarted');
    assert.equal(await tunnelWatchTick(state, w.deps), 'cooldown');
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      w.advance(COOLDOWN_MS);
      assert.equal(await tunnelWatchTick(state, w.deps), 'restarted');
    }
    w.advance(COOLDOWN_MS);
    assert.equal(await tunnelWatchTick(state, w.deps), 'gave-up');
    assert.equal(w.restarts(), MAX_ATTEMPTS);
    assert.match(w.logs.join('\n'), /rút cáp cắm lại/);
  });

  it('máy vào sổ rồi rớt lại thì là đợt mới, được thử lại từ đầu', async () => {
    let registry: string[] = [];
    const w = world({ registry: undefined });
    w.deps.registry = async () => registry;
    const state = newTunnelWatchState();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await tunnelWatchTick(state, w.deps);
      await tunnelWatchTick(state, w.deps);
      w.advance(COOLDOWN_MS);
    }
    registry = ['IPHONE-16'];
    assert.equal(await tunnelWatchTick(state, w.deps), 'ok');
    registry = [];
    await tunnelWatchTick(state, w.deps);
    assert.equal(await tunnelWatchTick(state, w.deps), 'restarted');
  });

  it('log mỗi tình huống một lần, không lặp mỗi nhịp', async () => {
    const w = world({ busy: async () => true });
    const state = newTunnelWatchState();
    for (let i = 0; i < 5; i += 1) await tunnelWatchTick(state, w.deps);
    assert.equal(w.logs.length, 1);
  });
});
