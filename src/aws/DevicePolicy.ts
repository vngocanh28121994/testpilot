/**
 * Deterministic device selection policy — item 39 (plan §65).
 *
 * Policy is deterministic and reproducible — no LLM is needed for the core
 * selection rules. AI may add recommendations when policy cannot find enough
 * devices, but it never overrides a hard rule.
 *
 * Rules (plan §65):
 *   P0 Android → at least 2 OS versions
 *   P0 iOS     → at least 2 OS versions
 *   P1         → 1 representative device per platform
 *   P2/P3      → sample device (cheapest available)
 *
 * Selection criteria (plan §65):
 *   1. business criticality (test priority)
 *   2. supported OS versions
 *   3. minimum device coverage
 *   4. historical failure rate on device
 *   5. changed platform flag
 */

import type { FarmDevice } from '../farm/devicefarm.js';

// ── policy types ──────────────────────────────────────────────────────────────

export type DevicePriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface DeviceRequirement {
  /** Minimum distinct OS versions that must be covered. */
  minOsVersions: number;
  /** Minimum total devices to select. */
  minDevices: number;
  /** Maximum devices allowed — guardrail against infinite matrix expansion (plan §66). */
  maxDevices: number;
  /** Prefer HIGHLY_AVAILABLE devices; fall back when unavailable. */
  preferAvailable: boolean;
  /** Exclude emulators — real devices catch more issues. */
  realDeviceOnly: boolean;
}

export interface OsSupportRange {
  /** Minimum OS version string (inclusive), e.g. "12.0" for Android. */
  min?: string;
  /** Maximum OS version string (inclusive). */
  max?: string;
  /** Explicit allowlist overrides min/max when provided. */
  allowedVersions?: string[];
}

export interface DevicePolicy {
  /** Determines the base requirement set. */
  priority: DevicePriority;
  /** OS version constraints per platform. */
  osSupport?: {
    android?: OsSupportRange;
    ios?: OsSupportRange;
  };
  /** Override computed requirements. All fields are optional. */
  overrides?: Partial<DeviceRequirement>;
  /**
   * Devices that historically fail on this test (by ARN).
   * They are deprioritised but not excluded unless `excludeHistoricalFailures` is set.
   */
  historicalFailureArns?: string[];
  excludeHistoricalFailures?: boolean;
  /** Flag from CI: only include devices matching the changed platform. */
  changedPlatform?: 'android' | 'ios';
}

// ── requirement resolver ──────────────────────────────────────────────────────

/**
 * Returns concrete requirements derived from a DevicePolicy.
 * Callers then pass the result to DeviceSelection.select().
 */
export function resolveRequirements(policy: DevicePolicy): DeviceRequirement {
  const base = BASE_REQUIREMENTS[policy.priority];
  return { ...base, ...(policy.overrides ?? {}) };
}

const BASE_REQUIREMENTS: Record<DevicePriority, DeviceRequirement> = {
  P0: {
    minOsVersions: 2,
    minDevices: 2,
    maxDevices: 6,
    preferAvailable: true,
    realDeviceOnly: true,
  },
  P1: {
    minOsVersions: 1,
    minDevices: 1,
    maxDevices: 3,
    preferAvailable: true,
    realDeviceOnly: true,
  },
  P2: {
    minOsVersions: 1,
    minDevices: 1,
    maxDevices: 2,
    preferAvailable: false,
    realDeviceOnly: false,
  },
  P3: {
    minOsVersions: 1,
    minDevices: 1,
    maxDevices: 1,
    preferAvailable: false,
    realDeviceOnly: false,
  },
};

// ── OS version filtering ──────────────────────────────────────────────────────

/** Returns true when the device's OS version is within the policy support range. */
export function isOsVersionSupported(device: FarmDevice, range?: OsSupportRange): boolean {
  if (!range) return true;

  const osVer = device.os;

  if (range.allowedVersions) {
    return range.allowedVersions.some((v) => osVer.startsWith(v));
  }

  const cmp = (a: string, b: string): number => {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
      const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  if (range.min && cmp(osVer, range.min) < 0) return false;
  if (range.max && cmp(osVer, range.max) > 0) return false;
  return true;
}

/** Convenience: build a policy for a given priority with optional OS constraints. */
export function makePolicy(
  priority: DevicePriority,
  opts: Omit<DevicePolicy, 'priority'> = {},
): DevicePolicy {
  return { priority, ...opts };
}
