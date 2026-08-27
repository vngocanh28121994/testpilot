import { createFileRoute } from '@tanstack/react-router';
import FarmPanel from '@/panels/Farm';

export const Route = createFileRoute('/farm')({ component: FarmPanel });
