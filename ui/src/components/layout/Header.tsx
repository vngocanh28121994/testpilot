import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

type HeaderProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean;
  ref?: React.Ref<HTMLElement>;
};

/**
 * Theo sen/frontend/src/components/layout/header.tsx.
 *
 * Đổ bóng chỉ xuất hiện SAU khi cuộn quá 10px, không phải lúc nào cũng có:
 * một đường viền cứng ở đầu trang khi chưa cuộn làm header trông như bị tách
 * rời khỏi nội dung.
 */
export function Header({ className, fixed, children, ...props }: HeaderProps) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setOffset(document.body.scrollTop || document.documentElement.scrollTop);
    };
    document.addEventListener('scroll', onScroll, { passive: true });
    return () => document.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'z-50 h-16 bg-transparent',
        fixed && 'header-fixed peer/header sticky top-0 w-[inherit]',
        offset > 10 && fixed ? 'shadow' : 'shadow-none',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'relative flex h-full items-center gap-3 p-4 sm:gap-4',
          offset > 10 &&
            fixed &&
            'after:bg-background/60 after:absolute after:inset-0 after:-z-10 after:backdrop-blur-md',
        )}
      >
        <SidebarTrigger variant="outline" className="max-md:scale-125" />
        <Separator orientation="vertical" className="h-6" />
        {children}
      </div>
    </header>
  );
}
