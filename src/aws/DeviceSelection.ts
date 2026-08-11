/**
 * Device selection — item 40 (plan §65).
 *
 * Applies a DevicePolicy to a list of available FarmDevices and returns
 * the selected set deterministically. Selection is reproducible: same policy
 * + same device list → same result every time. AI is only consulted when
 * the deterministic rules cannot satisfy the minimum device requirement.
 */

import type { FarmDevice } from '../farm/devicefarm.js';
import type { DevicePolicy, DeviceRequirement } from './DevicePolicy.js';
import { resolveRequirements, isOsVersionSupported } from './DevicePolicy.js';

// ── result types ──────────────────────────────────────────────────────────────

export interface SelectedDevice {
  device: FarmDevice;
  /** Why this device was chosen — for auditability. */
  reason: string;
  /** True when the device had a historical failure but was selected anyway. */
  hasHistoricalFailure: boolean;
}

export interface SelectionResult {
  selected: SelectedDevice[];
  /** True when all policy requirements are satisfied. */
  satisfied: boolean;
  /** Requirement deltas — what the policy asked for vs what was found. */
  gaps: SelectionGap[];
  /** Human-readable summary for logs and agent events. */
  summary: string;
}

export interface SelectionGap {
  requirement: string;
  required: number;
  actual: number;
}

/** Pluggable AI provider for when policy can't find enough devices. */
export interface DeviceSelectionAiProvider {
  recommend(
    intent: string,
    available: FarmDevice[],
    shortfall: SelectionGap[],
  ): Promise<FarmDevice[]>;
}

// ── selector ──────────────────────────────────────────────────────────────────

export class DeviceSelection {
  constructor(private readonly aiProvider?: DeviceSelectionAiProvider) {}

  /**
   * Select devices from `available` according to `policy`.
   * `platform` restricts the pool to 'android' | 'ios'.
   */
  async select(
    available: FarmDevice[],
    policy: DevicePolicy,
    platform: 'android' | 'ios',
  ): Promise<SelectionResult> {
    const req = resolveRequirements(policy);

    // ── 1. Filter pool ────────────────────────────────────────────────────────
    let pool = available.filter(
      (d) => d.platform.toLowerCase() === platform,
    );

    // Changed-platform filter
    if (policy.changedPlatform && policy.changedPlatform !== platform) {
      return emptyResult('changed-platform filter excludes this platform');
    }

    // OS version support
    const osRange = platform === 'android'
      ? policy.osSupport?.android
      : policy.osSupport?.ios;

    pool = pool.filter((d) => isOsVersionSupported(d, osRange));

    // Real device filter
    if (req.realDeviceOnly) {
      pool = pool.filter((d) => d.remoteAccessEnabled);
    }

    // Availability preference
    const available_ = pool.filter((d) =>
      d.availability === 'HIGHLY_AVAILABLE' || d.availability === 'AVAILABLE',
    );
    const fallback = pool.filter(
      (d) => d.availability !== 'HIGHLY_AVAILABLE' && d.availability !== 'AVAILABLE',
    );

    pool = req.preferAvailable && available_.length > 0 ? available_.concat(fallback) : pool;

    // Exclude known failure devices if policy requires
    const failureArns = new Set(policy.historicalFailureArns ?? []);
    if (policy.excludeHistoricalFailures) {
      pool = pool.filter((d) => !failureArns.has(d.arn));
    }

    // ── 2. Deterministic selection by OS version coverage ────────────────────
    const selected = selectByOsCoverage(pool, req, failureArns);

    // ── 3. Gap analysis ───────────────────────────────────────────────────────
    const gaps = computeGaps(selected, req);

    // ── 4. AI fallback when not satisfied ────────────────────────────────────
    let finalSelected = selected;
    if (gaps.length > 0 && this.aiProvider) {
      const remaining = pool.filter(
        (d) => !selected.some((s) => s.device.arn === d.arn),
      );
      const aiSuggestions = await this.aiProvider.recommend(
        `Select additional ${platform} devices to satisfy: ${gaps.map((g) => g.requirement).join(', ')}`,
        remaining,
        gaps,
      );
      for (const d of aiSuggestions) {
        if (finalSelected.length >= req.maxDevices) break;
        if (!finalSelected.some((s) => s.device.arn === d.arn)) {
          finalSelected.push({
            device: d,
            reason: 'AI recommendation (policy gap)',
            hasHistoricalFailure: failureArns.has(d.arn),
          });
        }
      }
    }

    const satisfied = computeGaps(finalSelected, req).length === 0;
    const finalGaps = computeGaps(finalSelected, req);
    const summary = buildSummary(finalSelected, satisfied, finalGaps, platform);

    return { selected: finalSelected, satisfied, gaps: finalGaps, summary };
  }
}

// ── selection algorithm ───────────────────────────────────────────────────────

/**
 * Select devices prioritising OS version diversity, then availability.
 * Within the same OS version, prefer devices without historical failures.
 */
function selectByOsCoverage(
  pool: FarmDevice[],
  req: DeviceRequirement,
  failureArns: Set<string>,
): SelectedDevice[] {
  const selected: SelectedDevice[] = [];
  const coveredOs = new Set<string>();

  // Sort pool: no-failure first, then by availability rank
  const ranked = [...pool].sort((a, b) => {
    const aFail = failureArns.has(a.arn) ? 1 : 0;
    const bFail = failureArns.has(b.arn) ? 1 : 0;
    if (aFail !== bFail) return aFail - bFail;
    return availabilityRank(b.availability) - availabilityRank(a.availability);
  });

  // First pass: one device per OS version until minOsVersions covered
  for (const d of ranked) {
    if (selected.length >= req.maxDevices) break;
    if (!coveredOs.has(d.os)) {
      coveredOs.add(d.os);
      selected.push({
        device: d,
        reason: `covers OS ${d.os} (first device for this version)`,
        hasHistoricalFailure: failureArns.has(d.arn),
      });
    }
  }

  // Second pass: fill up to minDevices if needed
  if (selected.length < req.minDevices) {
    for (const d of ranked) {
      if (selected.length >= req.maxDevices) break;
      if (selected.some((s) => s.device.arn === d.arn)) continue;
      selected.push({
        device: d,
        reason: `additional device to meet minDevices=${req.minDevices}`,
        hasHistoricalFailure: failureArns.has(d.arn),
      });
      if (selected.length >= req.minDevices) break;
    }
  }

  return selected;
}

function availabilityRank(av: string): number {
  if (av === 'HIGHLY_AVAILABLE') return 2;
  if (av === 'AVAILABLE') return 1;
  return 0;
}

function computeGaps(selected: SelectedDevice[], req: DeviceRequirement): SelectionGap[] {
  const gaps: SelectionGap[] = [];

  const deviceCount = selected.length;
  if (deviceCount < req.minDevices) {
    gaps.push({ requirement: 'minDevices', required: req.minDevices, actual: deviceCount });
  }

  const osVersionCount = new Set(selected.map((s) => s.device.os)).size;
  if (osVersionCount < req.minOsVersions) {
    gaps.push({ requirement: 'minOsVersions', required: req.minOsVersions, actual: osVersionCount });
  }

  return gaps;
}

function buildSummary(
  selected: SelectedDevice[],
  satisfied: boolean,
  gaps: SelectionGap[],
  platform: string,
): string {
  const osVersions = [...new Set(selected.map((s) => s.device.os))].join(', ');
  const base = `Selected ${selected.length} ${platform} device(s) covering OS [${osVersions}]`;
  if (satisfied) return `${base} — policy satisfied`;
  const gapStr = gaps.map((g) => `${g.requirement}: need ${g.required}, got ${g.actual}`).join('; ');
  return `${base} — policy NOT satisfied: ${gapStr}`;
}

function emptyResult(reason: string): SelectionResult {
  return { selected: [], satisfied: true, gaps: [], summary: reason };
}
