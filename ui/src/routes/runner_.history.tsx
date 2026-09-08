/* eslint-disable react-refresh/only-export-components */
import { createFileRoute } from '@tanstack/react-router';
import RunnerHistoryPanel from '@/panels/RunnerHistory';

export const Route = createFileRoute('/runner_/history')({
  validateSearch: (search: Record<string, unknown>) => ({ runId: typeof search.runId === 'string' ? search.runId : undefined }),
  component: RunnerHistoryRoute,
});

function RunnerHistoryRoute() { return <RunnerHistoryPanel runId={Route.useSearch().runId} />; }
