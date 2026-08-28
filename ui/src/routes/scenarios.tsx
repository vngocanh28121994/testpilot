/* eslint-disable react-refresh/only-export-components */
import { createFileRoute } from '@tanstack/react-router';
import ScenarioReviewPanel, { type ScenarioSearch } from '@/panels/ScenarioReview';

export const Route = createFileRoute('/scenarios')({
  validateSearch: (search: Record<string, unknown>): ScenarioSearch => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    file: typeof search.file === 'string' ? search.file : undefined,
    status: search.status === 'pending' || search.status === 'approved' || search.status === 'rejected' ? search.status : undefined,
    tags: Array.isArray(search.tags) ? search.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    page: typeof search.page === 'number' && Number.isInteger(search.page) && search.page > 1 ? search.page : undefined,
    runId: typeof search.runId === 'string' && search.runId ? search.runId : undefined,
  }),
  component: ScenarioRoute,
});

function ScenarioRoute() { return <ScenarioReviewPanel search={Route.useSearch()} />; }
