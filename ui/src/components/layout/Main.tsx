import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Main({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn('min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6', className)}>{children}</main>;
}
