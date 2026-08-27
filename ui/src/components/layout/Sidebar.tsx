import { Link, useRouterState } from '@tanstack/react-router';
import { CircleDashed } from 'lucide-react';
import { NAV } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * 14 mục điều hướng, đúng thứ tự của app.js:71.
 *
 * Sáu mục có `why` là placeholder — chúng vẫn hiện, vẫn bấm được, và dẫn tới
 * trang `todo` giải thích vì sao chưa nối. Đánh dấu bằng icon mờ chứ không
 * disable: một mục bấm không được thì không nói được lý do.
 */
export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="bg-sidebar border-sidebar-border flex w-60 shrink-0 flex-col border-r">
      <div className="border-sidebar-border flex h-14 items-center gap-2 border-b px-4">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-6" />
        <span className="font-semibold">TestPilot</span>
      </div>

      <nav aria-label="Điều hướng chính" className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = pathname === item.to || (item.to !== '/' && pathname.startsWith(item.to));
            return (
              <li key={item.id}>
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  title={item.why}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    active
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
                  )}
                >
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.why && (
                    <CircleDashed
                      className="text-muted-foreground size-3.5 shrink-0"
                      aria-label="chưa nối"
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
