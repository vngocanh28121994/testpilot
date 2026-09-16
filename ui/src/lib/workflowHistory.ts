import type { RunHistoryEntry } from '@core/ui/contracts.js';

/**
 * Records owned by Workflow History.
 *
 * Device Farm has its own history and detail screens. Keeping this predicate
 * shared prevents the Studio preview and “Xem tất cả” page from silently
 * disagreeing again when another run kind is added.
 */
export function isWorkflowHistoryRun(run: Pick<RunHistoryEntry, 'kind'>): boolean {
  return run.kind !== 'farm';
}
