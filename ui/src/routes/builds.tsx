import { createFileRoute } from '@tanstack/react-router';
import BuildsPanel from '@/panels/Builds';

export const Route = createFileRoute('/builds')({ component: BuildsPanel });
