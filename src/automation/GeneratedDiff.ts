/**
 * Generated diff — item 38 (plan §59).
 *
 * Every set of AI-generated changes is wrapped in a GeneratedDiff before being
 * applied. The diff records what changed, why, and whether guardrails passed.
 * Human approval is required when any protected path would be modified.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { GeneratedFile, FileDiff, GeneratedDiff, ValidationSummary } from './AutomationTypes.js';
import { isProtectedPath } from './AutomationTypes.js';

// ── diff builder ──────────────────────────────────────────────────────────────

/**
 * Build a `GeneratedDiff` from a list of generated files.
 *
 * Reads existing files from disk (when action='modify') to compute line counts.
 * All diffs are stored as unified-diff strings for human review.
 */
export async function buildDiff(
  scenarioId: string,
  files: GeneratedFile[],
  reason: string,
  extraProtected: RegExp[] = [],
): Promise<GeneratedDiff> {
  const fileDiffs: FileDiff[] = [];
  const violatingPaths: string[] = [];

  for (const file of files) {
    if (isProtectedPath(file.path, extraProtected)) {
      violatingPaths.push(file.path);
    }

    const diff = await computeFileDiff(file);
    fileDiffs.push(diff);
  }

  return {
    scenarioId,
    files: fileDiffs,
    reason,
    guardrailPassed: violatingPaths.length === 0,
    violatingPaths,
  };
}

/** Attach a ValidationSummary to an existing diff (called after CompileGate runs). */
export function attachValidation(
  diff: GeneratedDiff,
  validation: ValidationSummary,
): GeneratedDiff {
  return { ...diff, validation };
}

// ── file diff computation ─────────────────────────────────────────────────────

async function computeFileDiff(file: GeneratedFile): Promise<FileDiff> {
  if (file.action === 'create') {
    const linesAdded = countLines(file.content);
    return {
      path: file.path,
      action: 'create',
      unifiedDiff: formatCreateDiff(file.path, file.content),
      linesAdded,
      linesRemoved: 0,
    };
  }

  // action = 'modify' — read existing content for comparison
  let existingContent = '';
  if (existsSync(file.path)) {
    existingContent = await readFile(file.path, 'utf8');
  }

  const { unifiedDiff, linesAdded, linesRemoved } = computeUnifiedDiff(
    file.path,
    existingContent,
    file.content,
  );

  return { path: file.path, action: 'modify', unifiedDiff, linesAdded, linesRemoved };
}

// ── diff helpers ──────────────────────────────────────────────────────────────

/** Minimal unified diff for a new file (no existing content). */
function formatCreateDiff(path: string, content: string): string {
  const lines = content.split('\n');
  const added = lines.map((l) => `+${l}`).join('\n');
  return `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${added}`;
}

/**
 * Compute a unified diff between two strings.
 *
 * Uses a simple line-by-line LCS approach — suitable for small generated files.
 * For production use, consider the `diff` npm package.
 */
function computeUnifiedDiff(
  path: string,
  oldContent: string,
  newContent: string,
): { unifiedDiff: string; linesAdded: number; linesRemoved: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  if (oldContent === newContent) {
    return { unifiedDiff: '(no changes)', linesAdded: 0, linesRemoved: 0 };
  }

  const hunks = computeHunks(oldLines, newLines);
  const linesAdded = hunks.filter((l) => l.startsWith('+')).length;
  const linesRemoved = hunks.filter((l) => l.startsWith('-')).length;

  const header = `--- a/${path}\n+++ b/${path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@`;
  const unifiedDiff = `${header}\n${hunks.join('\n')}`;

  return { unifiedDiff, linesAdded, linesRemoved };
}

/**
 * Produce diff hunks using a simple line comparison.
 * Lines present in old but not new → '-'; lines in new but not old → '+'.
 */
function computeHunks(oldLines: string[], newLines: string[]): string[] {
  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  // Trace back LCS
  const hunks: string[] = [];
  let i = m;
  let j = n;
  const ops: Array<{ op: ' ' | '+' | '-'; line: string }> = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ op: ' ', line: oldLines[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.unshift({ op: '+', line: newLines[j - 1]! });
      j--;
    } else {
      ops.unshift({ op: '-', line: oldLines[i - 1]! });
      i--;
    }
  }

  for (const { op, line } of ops) {
    hunks.push(`${op}${line}`);
  }
  return hunks;
}

function countLines(content: string): number {
  return content.split('\n').length;
}

// ── guardrail report ──────────────────────────────────────────────────────────

/** Human-readable summary of a GeneratedDiff for review. */
export function formatDiffSummary(diff: GeneratedDiff): string {
  const lines: string[] = [
    `Scenario: ${diff.scenarioId}`,
    `Reason: ${diff.reason}`,
    `Guardrail: ${diff.guardrailPassed ? 'PASSED' : 'FAILED'}`,
    '',
    'Files:',
  ];

  for (const f of diff.files) {
    lines.push(
      `  [${f.action.toUpperCase()}] ${f.path} (+${f.linesAdded} -${f.linesRemoved})`,
    );
  }

  if (diff.violatingPaths.length > 0) {
    lines.push('', 'GUARDRAIL VIOLATIONS (must not apply):');
    for (const p of diff.violatingPaths) lines.push(`  ✗ ${p}`);
  }

  if (diff.validation) {
    lines.push('', `Validation: ${diff.validation.allPassed ? 'PASSED' : 'FAILED'}`);
    for (const s of diff.validation.stages) {
      lines.push(`  [${s.passed ? 'OK' : 'FAIL'}] ${s.name} (${s.durationMs}ms)`);
    }
  }

  return lines.join('\n');
}
