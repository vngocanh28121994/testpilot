import { createFileRoute } from '@tanstack/react-router';
import SettingsPanel from '@/panels/Settings';

export const Route = createFileRoute('/settings')({ component: SettingsPanel });
