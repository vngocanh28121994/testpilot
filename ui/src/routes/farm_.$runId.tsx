/* eslint-disable react-refresh/only-export-components */
import { createFileRoute } from '@tanstack/react-router';
import FarmDetailPanel from '@/panels/FarmDetail';

export const Route = createFileRoute('/farm_/$runId')({ component: FarmDetailRoute });

function FarmDetailRoute() { return <FarmDetailPanel runId={Route.useParams().runId} />; }
