import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';
import { Main } from './Main';
import { ThemeSwitch } from '@/components/ThemeSwitch';

/**
 * Khung trang dùng chung, theo khuôn authenticated-layout của sen:
 * SidebarProvider → AppSidebar + SidebarInset(Header + Main).
 *
 * Route file chỉ việc bọc nội dung vào đây, đúng kỷ luật "route là lớp mỏng"
 * của UI-MIGRATION-PLAN §3.1.
 */
export function AppShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Header fixed>
          <h1 className="text-sm font-medium">{title}</h1>
          <div className="ms-auto flex items-center gap-2">
            {actions}
            <ThemeSwitch />
          </div>
        </Header>
        <Main>{children}</Main>
      </SidebarInset>
    </SidebarProvider>
  );
}
