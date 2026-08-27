import { createFileRoute } from '@tanstack/react-router';
import RunnerPanel from '@/panels/Runner';

export const Route = createFileRoute('/runner')({ component: RunnerPanel });
