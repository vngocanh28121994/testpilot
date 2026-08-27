import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Main({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn('flex-1 overflow-y-auto p-6', className)}>{children}</main>;
}
