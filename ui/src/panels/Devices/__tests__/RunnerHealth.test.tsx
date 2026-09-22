/**
 * Bảng "máy chạy test": ba trạng thái, không phải hai.
 *
 * Trạng thái thứ ba là điểm chính của bài này. CHƯA ĐO khác với HỎNG, và vẽ
 * chúng giống nhau nghĩa là ai đó sẽ đi sửa một chiếc máy hoàn toàn tốt vừa
 * khởi động xong — hoặc bỏ qua một chiếc máy thật sự thiếu driver.
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';
import { ROUTES } from '@/api/routes';
import { RunnerHealth } from '@/panels/Devices/RunnerHealth';

const base = {
  id: 'runner:1',
  name: 'laptop-an',
  mode: 'personal' as const,
  visibility: 'private' as const,
  state: 'online' as const,
  createdAt: '2026-09-23T00:00:00.000Z',
};

function withRunners(...runners: unknown[]) {
  server.use(http.get(ROUTES.runners, () => HttpResponse.json({ runners })));
}

describe('Máy chạy test', () => {
  it('nói rõ máy nào thiếu gì, ngay trong ô', async () => {
    withRunners({
      ...base,
      prereq: {
        web: { ok: true, at: 'now' },
        android: { ok: false, reason: 'Appium chưa chạy trên máy này.', at: 'now' },
        ios: { ok: false, reason: 'Xcode chưa chọn đường dẫn.', at: 'now' },
      },
    });
    await renderWithRouter(<RunnerHealth />);

    const row = (await screen.findByText('laptop-an')).closest<HTMLElement>('tr')!;
    expect(within(row).getByText('sẵn sàng')).toBeInTheDocument();
    // Lý do nằm ngay trong ô, không nấp sau tooltip: người đọc bảng này đang
    // đi tìm việc cần làm.
    expect(within(row).getByText('Appium chưa chạy trên máy này.')).toBeInTheDocument();
    expect(within(row).getByText('Xcode chưa chọn đường dẫn.')).toBeInTheDocument();
  });

  it('chưa đo thì nói "chưa đo", không nói "hỏng"', async () => {
    withRunners({ ...base, mode: 'farm', state: 'online' });
    await renderWithRouter(<RunnerHealth />);

    const row = (await screen.findByText('laptop-an')).closest<HTMLElement>('tr')!;
    expect(within(row).getAllByText('chưa đo')).toHaveLength(3);
    expect(within(row).queryByText('chưa chạy được')).not.toBeInTheDocument();
  });

  it('máy tắt vẫn hiện, kèm chữ đang tắt', async () => {
    withRunners({ ...base, state: 'offline', prereq: { web: { ok: true, at: 'now' } } });
    await renderWithRouter(<RunnerHealth />);

    const row = (await screen.findByText('laptop-an')).closest<HTMLElement>('tr')!;
    expect(within(row).getByText('đang tắt')).toBeInTheDocument();
  });

  it('chưa có máy nào thì chỉ đường, không để bảng trống', async () => {
    withRunners();
    await renderWithRouter(<RunnerHealth />);
    expect(await screen.findByText(/Chưa máy nào đăng ký/)).toBeInTheDocument();
  });
});
