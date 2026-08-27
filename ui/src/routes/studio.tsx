import { createFileRoute } from '@tanstack/react-router';
import StudioPanel from '@/panels/Studio';

export const Route = createFileRoute('/studio')({ component: StudioPanel });
