import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';
import { Main } from './Main';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { DotBackground } from '@/components/DotBackground';

/**
 * Khung trang dùng chung, theo khuôn authenticated-layout của sen:
 * SidebarProvider → AppSidebar + SidebarInset(Header + Main).
 *
 * Route file chỉ việc bọc nội dung vào đây, đúng kỷ luật "route là lớp mỏng"
 * của UI-MIGRATION-PLAN §3.1.
 */
export function AppShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  /** Câu phụ cạnh tiêu đề, theo khuôn header của sen ("Settings - Manage …"). */
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* min-w-0: SidebarInset là flex item, mà flex item mặc định có
          min-width:auto — tức là không co nhỏ hơn nội dung của nó. Một bảng
          rộng vì thế kéo cả khung nội dung tràn qua phải màn hình thay vì để
          overflow-x-auto bên trong tự cuộn. sidebar.tsx là file vendor giống
          hệt bên sen nên không sửa ở đó; chặn tại đây. */}
      {/* isolate: SidebarInset thành một stacking context riêng, nhờ đó nền
          `fixed` bên trong không trèo lên sidebar (sidebar là anh em, z-10).
          Nền nằm ở z-0, Header (z-50) và Main (z-10) đè lên trên. */}
      <SidebarInset className="isolate min-w-0">
        <DotBackground disableMouseLinks className="fixed z-0" />
        <Header fixed>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-lg font-semibold">{title}</h1>
            {description && (
              <span className="text-muted-foreground truncate text-base max-md:hidden">
                - {description}
              </span>
            )}
          </div>
          <div className="ms-auto flex items-center gap-2">
            {actions}
            <ThemeSwitch />
          </div>
        </Header>
        <Main className="relative z-10">{children}</Main>
      </SidebarInset>
    </SidebarProvider>
  );
}
