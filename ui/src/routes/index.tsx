import { createFileRoute } from '@tanstack/react-router';
import DashboardPanel from '@/panels/Dashboard';

export const Route = createFileRoute('/')({ component: DashboardPanel });
