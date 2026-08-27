import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Main } from './Main';
import { ThemeSwitch } from '@/components/ThemeSwitch';

/**
 * Khung trang dùng chung. Route file chỉ việc bọc nội dung vào đây, đúng kỷ
 * luật "route là lớp mỏng" của UI-MIGRATION-PLAN §3.1.
 */
export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header>
          <h1 className="text-sm font-medium">{title}</h1>
          <div className="ms-auto flex items-center gap-2">
            {actions}
            <ThemeSwitch />
          </div>
        </Header>
        <Main>{children}</Main>
      </div>
    </div>
  );
}
