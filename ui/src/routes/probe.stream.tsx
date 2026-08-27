import { createFileRoute } from '@tanstack/react-router';
import StreamProbePanel from '@/panels/StreamProbe';

// Dev-only, xem panels/StreamProbe. Xoá cùng lúc với panel khi Local Runner xong.
export const Route = createFileRoute('/probe/stream')({ component: StreamProbePanel });
