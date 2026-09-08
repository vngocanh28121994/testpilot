import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { stateFixture } from '@/test/mocks/fixtures';
import RunnerHistoryPanel from '@/panels/RunnerHistory';

/**
 * Bốn lượt chạy trong cùng một ngày trên cùng một máy từng cho ra bốn cái nút
 * ghi y hệt nhau — "android · 8/9/2026" — nên không có cách nào biết mình đang
 * chọn cái nào, kể cả sau khi đã bấm.
 */
const sameDay = [
  { id: 'r-1', platform: 'android', tag: '@a', status: 'failed', startedAt: '2026-09-08T04:40:00.000Z', counters: { passed: 0, failed: 4 } },
  { id: 'r-2', platform: 'android', tag: '@a', status: 'passed', startedAt: '2026-09-08T05:03:00.000Z', counters: { passed: 8, failed: 1 } },
];

const render = async (runId?: string) => {
  server.use(http.get(ROUTES.state, () => HttpResponse.json({ ...stateFixture, reports: sameDay })));
  return renderWithRouter(<RunnerHistoryPanel runId={runId} />, { path: '/runner/history' });
};

describe('Chi tiết lượt chạy — bộ chọn', () => {
  it('mỗi lượt chạy mang giờ riêng, không chỉ ngày', async () => {
    await render();
    // Chờ NỘI DUNG, không chờ cái vỏ: <ul> có mặt ngay từ lần render đầu, nên
    // findByRole('list') khớp trước khi dữ liệu kịp về và danh sách còn rỗng.
    const list = await screen.findByRole('list', { name: 'Các lượt chạy' });
    const buttons = await within(list).findAllByRole('button');
    const labels = buttons.map((b) => b.textContent ?? '');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('hiện kết quả pass/fail của từng lượt', async () => {
    await render();
    expect(await screen.findByText('8✓')).toBeInTheDocument();
    expect(screen.getByText('4✗')).toBeInTheDocument();
  });

  /**
   * Bấm "Chi tiết" ở một lượt chạy cũ phải mở đúng lượt đó. `runId` từng bị
   * dùng làm giá trị khởi tạo useState, mà lúc render đầu danh sách còn rỗng —
   * nên lượt nào cũng mở ra lượt mới nhất.
   */
  it('mở đúng lượt chạy mà URL chỉ tới', async () => {
    await render('r-1');
    const list = await screen.findByRole('list', { name: 'Các lượt chạy' });
    await within(list).findAllByRole('button');
    const current = within(list).getByRole('button', { current: true });
    expect(current.textContent).toContain('4✗');
  });

  it('không có runId thì mở lượt đầu danh sách', async () => {
    await render();
    const list = await screen.findByRole('list', { name: 'Các lượt chạy' });
    await within(list).findAllByRole('button');
    const current = within(list).getByRole('button', { current: true });
    expect(current.textContent).toContain('4✗');
  });
});
