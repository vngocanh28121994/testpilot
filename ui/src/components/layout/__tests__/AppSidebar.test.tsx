import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { renderWithRouter } from '@/test/utils';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { NAV } from '@/lib/nav';

const renderSidebar = () =>
  renderWithRouter(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );

/**
 * Sidebar là nơi dễ mất tính năng nhất trong một cuộc migrate: sáu mục
 * placeholder không có gì đứng sau nên rất dễ bị "dọn" đi, và bản mới trông
 * như thiếu tính năng so với bản cũ. NAV được chép từ app.js:71.
 */
describe('AppSidebar', () => {
  /**
   * shadcn Sidebar dựng toàn <div>. Khi migrate sang nó, landmark điều hướng
   * biến mất và người dùng trình đọc màn hình mất khả năng nhảy thẳng tới vùng
   * này. Đã xảy ra một lần — test này để nó không xảy ra lần nữa trong im lặng.
   */
  it('có landmark điều hướng có tên', async () => {
    await renderSidebar();
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
  });

  it('render đủ 14 mục, đúng thứ tự của app.js', async () => {
    await renderSidebar();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(14);
    expect(links.map((a) => a.textContent?.trim())).toEqual(NAV.map((n) => n.label));
  });

  it('đánh dấu 6 mục chưa nối và giữ nguyên lời giải thích', async () => {
    await renderSidebar();
    expect(screen.getAllByLabelText('chưa nối')).toHaveLength(6);
    expect(screen.getByRole('link', { name: /Zephyr/ })).toHaveAttribute(
      'title',
      'Đồng bộ kết quả sang Zephyr/Jira. Chưa nối.',
    );
  });

  it('mọi mục placeholder đều trỏ vào /todo/', () => {
    const placeholders = NAV.filter((n) => n.why);
    expect(placeholders).toHaveLength(6);
    for (const p of placeholders) expect(p.to).toBe(`/todo/${p.id}`);
  });
});
