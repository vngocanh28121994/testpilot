/**
 * Tự khởi động lại tunnel iOS khi có iPhone cắm cáp mà tunnel không giữ.
 *
 * Tunnel của Appium (`xcuitest tunnel-creation`) chỉ quét danh sách máy MỘT
 * lần, lúc khởi động. iPhone cắm vào sau đó — hoặc rớt cáp quá lâu — không bao
 * giờ tự vào sổ, và từ iOS 18 Appium chỉ tìm máy qua sổ này: màn Điều khiển
 * báo "Unknown device or simulator UDID" trong khi máy nằm ngay đó, cáp cắm.
 * Đo trên máy thật ngày 2026-09-26: iPhone 16 Pro Max rớt USB một nhịp lúc
 * 00:59, sổ tunnel về 0 máy và ở nguyên đó.
 *
 * Cách chữa duy nhất là khởi động lại tunnel. Vòng này làm việc đó thay người,
 * với bốn chốt chặn:
 *
 *   - chỉ khi tunnel chạy như DỊCH VỤ: đó là đường khởi động lại không cần mật
 *     khẩu. Không có dịch vụ thì im lặng — nút trên web vẫn mở Terminal được;
 *   - chỉ khi thiếu ở hai nhịp liên tiếp: tunnel tự nối lại được một nhịp rớt
 *     cáp ngắn, và khởi động lại lúc nó đang tự chữa là phá nó;
 *   - chỉ khi KHÔNG iPhone nào đang bận: khởi động lại tunnel làm đứt mọi phiên
 *     iOS đang chạy trên máy này — cứu một máy mới bằng cách giết lượt chạy của
 *     máy khác là đổi chác tồi;
 *   - tối đa ba lần cho mỗi máy, cách nhau ít nhất hai phút: tunnel không nhận
 *     được máy (máy khoá, chưa tin cậy) thì khởi động lại mãi cũng không nhận.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { wiredIphones } from '../core/iosDevices.js';
import { tunnelRegistryUdids } from '../core/preflight.js';
import { fixTunnel, tunnelServiceInstalled } from './prereq.js';

export interface TunnelWatchDeps {
  serviceInstalled(): boolean;
  /** udid của iPhone đang cắm cáp, đã ghép đôi. */
  wired(): Promise<string[]>;
  /** udid tunnel đang giữ; `undefined` khi không đọc được sổ. */
  registry(): Promise<string[] | undefined>;
  /** Có iPhone nào trong danh sách đang bị giữ (job đang chạy, người đang điều khiển). */
  busy(udids: string[]): Promise<boolean>;
  restart(): Promise<{ ok: boolean; error?: string }>;
  log(line: string): void;
  now(): number;
}

export type TunnelWatchOutcome =
  | 'no-service' | 'no-registry' | 'ok' | 'waiting' | 'cooldown' | 'gave-up' | 'busy' | 'restarted' | 'failed';

export interface TunnelWatchState {
  /** Số nhịp liên tiếp mỗi máy vắng mặt trong sổ. */
  missing: Map<string, number>;
  /** Số lần đã khởi động lại vì mỗi máy — trong đợt vắng mặt hiện tại. */
  attempts: Map<string, number>;
  lastRestartAt?: number;
  /** Nhịp trước đã báo điều này rồi thì thôi — log một dòng mỗi 30 giây là ồn. */
  lastLogged?: string;
}

export const MAX_ATTEMPTS = 3;
export const COOLDOWN_MS = 2 * 60_000;

export function newTunnelWatchState(): TunnelWatchState {
  return { missing: new Map(), attempts: new Map() };
}

/** Một nhịp canh. Tách khỏi bộ hẹn giờ để test đi từng nhịp. */
export async function tunnelWatchTick(state: TunnelWatchState, deps: TunnelWatchDeps): Promise<TunnelWatchOutcome> {
  const say = (key: string, line: string) => {
    if (state.lastLogged === key) return;
    state.lastLogged = key;
    deps.log(line);
  };
  if (!deps.serviceInstalled()) return 'no-service';
  const registry = await deps.registry();
  // Tunnel không chạy: dịch vụ launchd tự dựng lại khi nó chết (KeepAlive).
  if (!registry) return 'no-registry';

  const wired = await deps.wired();
  const missing = wired.filter((udid) => !registry.includes(udid));
  // Máy đã vào sổ (hoặc đã rút) thì quên hết về nó — lần vắng sau là đợt mới.
  for (const udid of [...state.missing.keys()]) {
    if (!missing.includes(udid)) {
      state.missing.delete(udid);
      state.attempts.delete(udid);
    }
  }
  if (missing.length === 0) {
    state.lastLogged = undefined;
    return 'ok';
  }
  for (const udid of missing) state.missing.set(udid, (state.missing.get(udid) ?? 0) + 1);

  if (!missing.some((udid) => (state.missing.get(udid) ?? 0) >= 2)) return 'waiting';

  const tryable = missing.filter((udid) => (state.attempts.get(udid) ?? 0) < MAX_ATTEMPTS);
  if (tryable.length === 0) {
    say(`gave-up:${missing.join(',')}`,
      `[tunnel] Đã khởi động lại tunnel ${MAX_ATTEMPTS} lần mà vẫn không nhận iPhone ${missing.join(', ')}. `
      + 'Mở khoá máy, bấm Tin cậy nếu máy hỏi, rồi rút cáp cắm lại.');
    return 'gave-up';
  }
  if (state.lastRestartAt !== undefined && deps.now() - state.lastRestartAt < COOLDOWN_MS) return 'cooldown';

  if (await deps.busy([...new Set([...wired, ...registry])])) {
    say(`busy:${tryable.join(',')}`,
      `[tunnel] iPhone ${tryable.join(', ')} đang cắm mà tunnel chưa nhận. Chờ lượt iOS đang chạy xong rồi `
      + 'mới khởi động lại tunnel — làm ngay sẽ đứt lượt đó.');
    return 'busy';
  }

  state.lastRestartAt = deps.now();
  for (const udid of tryable) state.attempts.set(udid, (state.attempts.get(udid) ?? 0) + 1);
  deps.log(`[tunnel] iPhone ${tryable.join(', ')} đang cắm mà tunnel chưa nhận — khởi động lại tunnel.`);
  const result = await deps.restart();
  if (!result.ok) {
    say(`failed:${result.error ?? ''}`, `[tunnel] Không khởi động lại được: ${result.error ?? 'không rõ lý do'}`);
    return 'failed';
  }
  state.lastLogged = undefined;
  return 'restarted';
}

/** iPhone cắm cáp, đọc từ `devicectl`. Hỏng thì rỗng: không biết thì không làm gì. */
async function wiredFromDevicectl(): Promise<string[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tp-tunnelwatch-'));
  const out = path.join(dir, 'devices.json');
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('xcrun', ['devicectl', 'list', 'devices', '--json-output', out], { timeout: 20_000 },
        (err) => (err ? reject(err) : resolve()));
    });
    return wiredIphones(JSON.parse(await readFile(out, 'utf8')));
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const TUNNEL_WATCH_MS = 30_000;

/**
 * Bật vòng canh. `busy` đọc từ kho lease mà job và màn Điều khiển cùng dùng —
 * lease đặt tên máy theo udid, nên so thẳng được với danh sách máy iOS.
 */
export function startTunnelWatch(opts: {
  leases: { list(): Promise<Array<{ deviceId: string }>> };
  log?: (line: string) => void;
  intervalMs?: number;
}): { stop(): void } {
  if (process.platform !== 'darwin') return { stop() {} };
  const state = newTunnelWatchState();
  const deps = tunnelWatchDeps(opts);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void tunnelWatchTick(state, deps)
      .catch((err: Error) => deps.log(`[tunnel] vòng canh hỏng: ${err.message}`))
      .finally(() => { running = false; });
  }, opts.intervalMs ?? TUNNEL_WATCH_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

/** Bộ phụ thuộc thật: devicectl, sổ tunnel, kho lease, dịch vụ launchd. */
export function tunnelWatchDeps(opts: {
  leases: { list(): Promise<Array<{ deviceId: string }>> };
  log?: (line: string) => void;
}): TunnelWatchDeps {
  return {
    serviceInstalled: tunnelServiceInstalled,
    wired: wiredFromDevicectl,
    registry: tunnelRegistryUdids,
    busy: async (udids) => {
      const held = await opts.leases.list().catch(() => [] as Array<{ deviceId: string }>);
      return held.some((lease) => udids.includes(lease.deviceId));
    },
    restart: async () => {
      const fixed = await fixTunnel();
      return { ok: fixed.ok, ...(fixed.error ? { error: fixed.error } : {}) };
    },
    log: opts.log ?? ((line) => console.log(line)),
    now: () => Date.now(),
  };
}
