/**
 * Which handsets are physically attached right now.
 *
 * The config is a roster of the phones a team owns; this is the answer to a
 * different question, and the two are deliberately kept apart. A device id has
 * to stay stable — it goes into run directory names and into HealingStore's
 * dedupe key — so it cannot be derived from whatever happens to be plugged in
 * at the moment. What this module is for is letting the roster be checked
 * against reality: skipping an entry whose phone is unplugged, and finding a
 * phone that is attached but not yet in the roster.
 *
 * Every probe fails open. A missing `adb`, an Xcode without the device tools,
 * a hung `xctrace` — none of them are evidence that a device is absent, so a
 * failed probe reports itself as failed and callers keep every configured
 * device rather than silently running fewer than they were asked to.
 */
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { Platform } from './types.js';

const execAsync = promisify(execCb);

/** `xcrun xctrace list devices` has been seen to hang; no probe may block a run. */
const PROBE_TIMEOUT_MS = 15_000;

export interface AttachedDevice {
  /** adb serial on Android, the device UDID on iOS. Matches DeviceSpec.udid. */
  udid: string;
  /** Raw model code, e.g. SM_S918B. */
  model?: string;
}

export type ProbeResult =
  | { ok: true; devices: AttachedDevice[] }
  | { ok: false; reason: string };

export async function attachedDevices(platform: Platform): Promise<ProbeResult> {
  if (platform === 'android') return attachedAndroid();
  if (platform === 'ios') return attachedIos();
  return { ok: true, devices: [] };
}

async function attachedAndroid(): Promise<ProbeResult> {
  try {
    const { stdout } = await execAsync('adb devices -l', { timeout: PROBE_TIMEOUT_MS });
    const devices: AttachedDevice[] = [];
    for (const line of stdout.split('\n').slice(1)) {
      // `unauthorized` and `offline` are attached but undrivable; treating them
      // as present would trade a clear skip for an obscure session failure.
      const match = /^(\S+)\s+device\b(.*)$/.exec(line.trim());
      if (!match) continue;
      const model = /\bmodel:(\S+)/.exec(match[2] ?? '')?.[1];
      devices.push({ udid: match[1]!, ...(model ? { model } : {}) });
    }
    return { ok: true, devices };
  } catch (err) {
    return { ok: false, reason: probeError(err, 'adb') };
  }
}

async function attachedIos(): Promise<ProbeResult> {
  try {
    const { stdout } = await execAsync('xcrun xctrace list devices', {
      timeout: PROBE_TIMEOUT_MS,
    });
    const devices: AttachedDevice[] = [];
    for (const line of stdout.split('\n')) {
      // Only the physical section counts; everything below "== Simulators =="
      // is a simulator, which no `udid` in the config refers to.
      if (/^==\s*Simulators/i.test(line.trim())) break;
      const match = /^(.*?)\s*\(([\d.]+)\)\s*\(([0-9A-Fa-f-]{8,})\)\s*$/.exec(line.trim());
      if (!match) continue;
      devices.push({ udid: match[3]!, ...(match[1] ? { model: match[1] } : {}) });
    }
    return { ok: true, devices };
  } catch (err) {
    return { ok: false, reason: probeError(err, 'xcrun xctrace') };
  }
}

function probeError(err: unknown, tool: string): string {
  const e = err as Error & { code?: string | number; killed?: boolean; stderr?: string };
  if (e?.killed) return `${tool} không phản hồi sau ${PROBE_TIMEOUT_MS / 1000}s`;
  const text = (e?.stderr || e?.message || String(err)).trim().split('\n').filter(Boolean).pop();
  return `${tool}: ${text ?? 'lỗi không rõ nguyên nhân'}`;
}
