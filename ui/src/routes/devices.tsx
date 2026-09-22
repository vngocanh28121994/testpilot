import { createFileRoute } from '@tanstack/react-router';
import DevicesPanel from '@/panels/Devices';

export const Route = createFileRoute('/devices')({ component: DevicesPanel });
