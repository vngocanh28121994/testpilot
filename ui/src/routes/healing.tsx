import { createFileRoute } from '@tanstack/react-router';
import HealingPanel from '@/panels/Healing';

export const Route = createFileRoute('/healing')({ component: HealingPanel });
