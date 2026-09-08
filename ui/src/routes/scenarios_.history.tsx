/* eslint-disable react-refresh/only-export-components */
import { createFileRoute } from '@tanstack/react-router';
import HistoryPanel from '@/panels/History';

export const Route = createFileRoute('/scenarios_/history')({
  validateSearch: (search: Record<string, unknown>) => ({ focusId: typeof search.focusId === 'string' ? search.focusId : undefined }),
  component: ScenarioHistoryRoute,
});

function ScenarioHistoryRoute() { return <HistoryPanel focusId={Route.useSearch().focusId} />; }
