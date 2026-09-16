/** Shared evidence semantics for the React UI and the standalone HTML report. */

export type EvidenceKind = 'failed' | 'known' | 'passed' | 'other';

export interface EvidenceShot {
  name: string;
  url: string;
  onFailure: boolean;
  scenario?: string;
  detail?: string;
  error?: string;
  /** Human-approved reason this technical failure is tracked separately. */
  knownIssue?: string;
}

export interface EvidenceChapter {
  name: string;
  status: string;
  at: number;
}

export interface ShotLabel {
  scenario: string;
  detail: string;
}

export interface ShotEvidence<T extends EvidenceShot = EvidenceShot> {
  shot: T;
  label: ShotLabel;
  kind: EvidenceKind;
  /** Scenario offset when the filename can be joined to a chapter. */
  at: number;
}

export const EVIDENCE_GROUPS = [
  { kind: 'failed', title: 'Case fail', badge: 'FAIL' },
  { kind: 'passed', title: 'Case pass', badge: 'PASS' },
  { kind: 'other', title: 'Ảnh bổ sung', badge: 'INFO' },
] as const;

/** Requires scenario-level registry metadata, which raw screenshot names lack. */
export const KNOWN_ISSUE_GROUP = {
  kind: 'known', title: 'Known issue', badge: 'KNOWN ISSUE',
} as const;

const FAIL = /^(.*)-a(\d+)-l(\d+)-fail$/;
const PASS = /^(.*)-a(\d+)(?:-l(\d+))?-pass$/;

export function shotLabel(name: string, onFailure: boolean): ShotLabel {
  const failed = FAIL.exec(name);
  if (failed) {
    const [, scenario, attempt, line] = failed;
    return {
      scenario: humanise(scenario!),
      detail: `lúc fail · dòng ${line}${Number(attempt) > 1 ? ` · lần thử ${attempt}` : ''}`,
    };
  }
  const passed = PASS.exec(name);
  if (passed) {
    const [, scenario, attempt, line] = passed;
    return {
      scenario: humanise(scenario!),
      detail: `bằng chứng tại lúc kiểm tra${line ? ` · dòng ${line}` : ''}`
        + `${Number(attempt) > 1 ? ` · lần thử ${attempt}` : ''}`,
    };
  }
  return { scenario: '', detail: onFailure ? `lúc fail · ${name}` : name };
}

export function evidenceKind(
  name: string,
  onFailure: boolean,
  knownIssue = false,
): EvidenceKind {
  // A known issue still has a failed step and error text, so this check must
  // precede `onFailure`; otherwise every known screenshot falls back into red.
  if (knownIssue) return 'known';
  if (onFailure || name.startsWith('tap-declined-') || FAIL.test(name)) return 'failed';
  if (PASS.test(name)) return 'passed';
  return 'other';
}

export function buildShotEvidence<T extends EvidenceShot>(
  shots: readonly T[],
  chapters: readonly EvidenceChapter[] = [],
): ShotEvidence<T>[] {
  return shots.map((shot) => {
    const kind = evidenceKind(shot.name, shot.onFailure, Boolean(shot.knownIssue));
    const fallback = shotLabel(shot.name, kind === 'failed');
    const chapter = chapterForShot(shot.name, chapters);
    return {
      shot,
      kind,
      label: {
        scenario: shot.scenario ?? chapter?.name ?? fallback.scenario,
        detail: shot.detail ?? fallback.detail,
      },
      at: chapter?.at ?? Number.POSITIVE_INFINITY,
    };
  });
}

/** Timeline order with stable input order when timestamps tie or are missing. */
export function sortEvidenceTimeline<T>(
  values: readonly T[],
  timestamp: (value: T) => number,
): T[] {
  return values
    .map((value, index) => ({ value, index, at: timestamp(value) }))
    .sort((left, right) => {
      const leftAt = Number.isFinite(left.at) ? left.at : Number.POSITIVE_INFINITY;
      const rightAt = Number.isFinite(right.at) ? right.at : Number.POSITIVE_INFINITY;
      return leftAt - rightAt || left.index - right.index;
    })
    .map(({ value }) => value);
}

function chapterForShot(
  shotName: string,
  chapters: readonly EvidenceChapter[],
): EvidenceChapter | undefined {
  const fileSlug = slug(shotName);
  return [...chapters]
    .filter((chapter) => fileSlug.includes(slug(chapter.name)))
    .sort((left, right) => slug(right.name).length - slug(left.name).length)[0];
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, '-');
}

function humanise(value: string): string {
  return value.replace(/-/g, ' ').trim();
}
