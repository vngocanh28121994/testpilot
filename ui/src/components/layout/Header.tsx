import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Header({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'border-border bg-background/95 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b px-6 backdrop-blur',
        className,
      )}
    >
      {children}
    </header>
  );
}
