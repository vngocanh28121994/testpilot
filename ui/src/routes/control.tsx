import { createFileRoute } from '@tanstack/react-router';
import DeviceControlPanel from '@/panels/DeviceControl';

export const Route = createFileRoute('/control')({ component: DeviceControlPanel });
