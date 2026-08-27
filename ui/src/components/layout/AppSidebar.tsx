import { Link, useRouterState } from '@tanstack/react-router';
import { CircleDashed } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { NAV } from '@/lib/nav';

/**
 * 14 mục điều hướng, đúng thứ tự của app.js:71, dựng trên shadcn Sidebar để
 * khớp khuôn của sen (thu gọn được, có rail, tự thành sheet trên mobile).
 *
 * Sáu mục có `why` là placeholder — vẫn hiện, vẫn bấm được, dẫn tới trang
 * `todo` giải thích vì sao chưa nối. Đánh dấu bằng icon mờ chứ không disable:
 * một mục bấm không được thì không nói được lý do.
 */
export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            className="size-6 shrink-0"
          />
          <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
            TestPilot
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* shadcn Sidebar dựng toàn <div>, không có landmark điều hướng nào.
            Bản cũ có <nav aria-label="Điều hướng chính"> và mất nó là một hồi
            quy khả truy cập thật: người dùng trình đọc màn hình mất khả năng
            nhảy thẳng tới vùng điều hướng. */}
        <nav aria-label="Điều hướng chính">
          <SidebarGroup>
            <SidebarMenu>
            {NAV.map((item) => {
              const active =
                pathname === item.to || (item.to !== '/' && pathname.startsWith(item.to));
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={item.why ? `${item.label} — ${item.why}` : item.label}
                  >
                    <Link to={item.to} title={item.why} onClick={() => setOpenMobile(false)}>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.why && (
                        <CircleDashed
                          className="text-muted-foreground size-3.5 shrink-0"
                          aria-label="chưa nối"
                        />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
