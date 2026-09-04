import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { renderWithRouter } from '@/test/utils';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { IN_PROGRESS, NAV, NAV_GROUPS } from '@/lib/nav';

const renderSidebar = () =>
  renderWithRouter(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
  );

/**
 * Mở mục cha "Inprogress"; Radix unmount phần con khi đóng nên phải bấm thật.
 *
 * Chờ một mục con xuất hiện rồi mới trả về. Bấm xong không có nghĩa là phần con
 * đã nằm trong DOM — Radix mount nó ở lần render sau, nên một khẳng định đồng
 * bộ ngay sau `click` thỉnh thoảng chạy trước lúc đó và đỏ ngẫu nhiên (đã bắt
 * gặp một lần: "chưa nối" đếm được 0 thay vì 6). Chờ ở đây thay vì ở từng test
 * để mọi nơi gọi đều được bảo vệ như nhau.
 */
async function expandInProgress() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Inprogress/ }));
  await screen.findByRole('link', { name: /Zephyr/ });
}

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

  /**
   * 14 mục của app.js:71 vẫn còn đủ, chỉ khác cách xếp: 8 mục có trang thật
   * nằm ở các nhóm trên, 6 mục chưa nối nằm dưới mục cha "Inprogress" và chỉ
   * hiện khi mở ra. Test đếm cả hai phần để việc gom nhóm không thể âm thầm
   * trở thành việc xoá mục.
   */
  it('render đủ 14 mục: 8 mục ngoài, 6 mục trong Inprogress', async () => {
    await renderSidebar();

    const topLevel = NAV_GROUPS.flatMap((g) => g.items);
    expect(topLevel).toHaveLength(8);
    expect(screen.getAllByRole('link')).toHaveLength(8);

    await expandInProgress();

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(14);
    expect(new Set(links.map((a) => a.textContent?.trim()))).toEqual(
      new Set(NAV.map((n) => n.label)),
    );
  });

  it('mục cha Inprogress gom đúng 6 mục chưa nối', () => {
    expect(IN_PROGRESS.label).toBe('Inprogress');
    expect(IN_PROGRESS.items.map((n) => n.id)).toEqual(NAV.filter((n) => n.why).map((n) => n.id));
    // Và không mục nào đã-nối lọt vào đó.
    expect(IN_PROGRESS.items.every((n) => n.why)).toBe(true);
  });

  it('đánh dấu 6 mục chưa nối và giữ nguyên lời giải thích', async () => {
    await renderSidebar();
    await expandInProgress();

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
