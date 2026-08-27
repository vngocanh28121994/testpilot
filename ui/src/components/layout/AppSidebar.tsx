import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { IN_PROGRESS, NAV_GROUPS, type NavItem } from '@/lib/nav';

/**
 * 14 mục điều hướng, chia nhóm theo khuôn NavGroup của sen (SidebarGroup +
 * SidebarGroupLabel, mục có con thì bọc Collapsible + SidebarMenuSub).
 *
 * Sáu mục có `why` là placeholder — vẫn hiện, vẫn bấm được, dẫn tới trang
 * `todo` giải thích vì sao chưa nối. Chúng nằm gọn dưới mục cha "Inprogress"
 * thay vì xen kẽ giữa các trang thật: một danh sách phẳng khiến thứ dùng được
 * và thứ chưa dùng được trông ngang hàng nhau.
 */
export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inProgressActive = IN_PROGRESS.items.some((item) => pathname.startsWith(item.to));

  return (
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt=""
            className="size-6 shrink-0 rounded"
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
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.title}>
              {group.title && <SidebarGroupLabel>{group.title}</SidebarGroupLabel>}
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavLink key={item.id} item={item} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}

          <SidebarGroup>
            <SidebarMenu>
              <InProgressMenu active={inProgressActive} pathname={pathname} />
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}

function isActive(pathname: string, to: string): boolean {
  return pathname === to || (to !== '/' && pathname.startsWith(to));
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive(pathname, item.to)} tooltip={item.label}>
        <Link to={item.to} onClick={() => setOpenMobile(false)}>
          <item.icon className="shrink-0" />
          <span className="flex-1 truncate">{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavSubLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={isActive(pathname, item.to)}>
        {/* `title` giữ nguyên lời giải thích để hover được ngay ở menu; không
            thay được bằng tooltip của SidebarMenuButton vì mục con không có. */}
        <Link to={item.to} title={item.why} onClick={() => setOpenMobile(false)}>
          <item.icon className="shrink-0" aria-label="chưa nối" />
          <span className="flex-1 truncate">{item.label}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

/**
 * Mục cha "Inprogress".
 *
 * Khi sidebar thu gọn còn icon, `SidebarMenuSub` bị ẩn bằng CSS — giữ nguyên
 * Collapsible ở trạng thái đó thì nút bấm không ra gì cả. Đổi sang dropdown,
 * đúng cách sen làm ở `SidebarMenuCollapsedDropdown`.
 */
function InProgressMenu({ active, pathname }: { active: boolean; pathname: string }) {
  const { state, isMobile, setOpenMobile } = useSidebar();

  if (state === 'collapsed' && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton tooltip={IN_PROGRESS.label} isActive={active}>
              <IN_PROGRESS.icon className="shrink-0" />
              <span className="flex-1 truncate">{IN_PROGRESS.label}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" sideOffset={4}>
            <DropdownMenuLabel>{IN_PROGRESS.label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {IN_PROGRESS.items.map((item) => (
              <DropdownMenuItem key={item.id} asChild>
                <Link to={item.to} title={item.why} onClick={() => setOpenMobile(false)}>
                  <item.icon className="shrink-0" aria-label="chưa nối" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  return (
    // Mở sẵn khi đang đứng ở một trang con: một mục cha đóng lại giấu mất
    // chính trang người dùng đang xem.
    <Collapsible asChild defaultOpen={active} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={IN_PROGRESS.label} isActive={active}>
            <IN_PROGRESS.icon className="shrink-0" />
            <span className="flex-1 truncate">{IN_PROGRESS.label}</span>
            <ChevronRight className="ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {IN_PROGRESS.items.map((item) => (
              <NavSubLink key={item.id} item={item} pathname={pathname} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
