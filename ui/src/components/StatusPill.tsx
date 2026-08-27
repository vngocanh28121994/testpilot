import { cn } from '@/lib/utils';

export function StatusPill({ status }: { status: string }) {
  const tone = /pass|done|approved|applied/i.test(status)
    ? 'bg-status-pass/15 text-status-pass'
    : /fail|reject|error/i.test(status)
      ? 'bg-status-fail/15 text-status-fail'
      : /running|waiting/i.test(status)
        ? 'bg-status-running/15 text-status-running'
        : 'bg-muted text-muted-foreground';
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', tone)}>{status}</span>;
}
