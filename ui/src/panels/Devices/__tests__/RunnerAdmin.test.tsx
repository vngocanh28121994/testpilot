/**
 * Thêm máy chạy test, và token hiện đúng một lần.
 *
 * Màn này là CỬA VÀO của cả mô hình: một chiếc điện thoại chỉ tới được hệ
 * thống qua một tiến trình runner chạy trên chiếc máy tính nó cắm vào, và
 * runner ấy cần token. Không có chỗ nào cấp token thì không ai nối máy của
 * mình vào được — trước màn này, cách duy nhất là gọi API bằng tay.
 */
import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { renderWithRouter, chooseFromDropdown } from '@/test/utils';
import { ROUTES } from '@/api/routes';
import { RunnerAdmin } from '@/panels/Devices/RunnerAdmin';

const RUNNER = {
  id: 'runner:abc123def456ghi789',
  name: 'laptop của Bình',
  mode: 'personal' as const,
  visibility: 'private' as const,
  state: 'online' as const,
  createdAt: '2026-09-23T00:00:00.000Z',
};

function withRunners(...runners: unknown[]) {
  server.use(http.get(ROUTES.runners, () => HttpResponse.json({ runners })));
}

describe('Máy chạy test', () => {
  it('chưa có máy nào thì chỉ đường, không để bảng trống', async () => {
    withRunners();
    await renderWithRouter(<RunnerAdmin />);
    expect(await screen.findByText(/Chưa máy nào đăng ký/)).toBeInTheDocument();
  });

  it('tạo máy xong thì hiện token KÈM câu lệnh đã điền sẵn', async () => {
    withRunners();
    let sent: unknown;
    server.use(http.post(ROUTES.runners, async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({ runner: RUNNER, token: 'TOKEN-BI-MAT' });
    }));

    const user = userEvent.setup();
    await renderWithRouter(<RunnerAdmin />);
    await user.click(await screen.findByRole('button', { name: /Thêm máy/ }));
    await user.type(screen.getByLabelText('Tên máy'), 'laptop của Bình');
    await user.click(screen.getByRole('button', { name: 'Tạo token' }));

    expect(sent).toEqual({
      name: 'laptop của Bình', mode: 'personal', visibility: 'private',
    });
    // Một chuỗi bốn mươi ba ký tự tự nó không nói cho ai biết phải làm gì với
    // nó, nên token nằm TRONG câu lệnh chạy runner, không đứng một mình.
    await screen.findByText(/chỉ hiện một lần/);
    const command = await screen.findByText(/npx testpilot-runner/);
    expect(command.textContent).toContain('TOKEN-BI-MAT');
    expect(command.textContent).toContain('TESTPILOT_SERVER=');
  });

  it('máy dùng chung thì để cả đội thấy', async () => {
    withRunners();
    let sent: { visibility?: string } | undefined;
    server.use(http.post(ROUTES.runners, async ({ request }) => {
      sent = (await request.json()) as { visibility?: string };
      return HttpResponse.json({ runner: RUNNER, token: 'x' });
    }));

    const user = userEvent.setup();
    await renderWithRouter(<RunnerAdmin />);
    await user.click(await screen.findByRole('button', { name: /Thêm máy/ }));
    await user.type(screen.getByLabelText('Tên máy'), 'máy chủ');
    await chooseFromDropdown('Loại máy', 'Máy dùng chung — cả đội thấy');
    await user.click(screen.getByRole('button', { name: 'Tạo token' }));

    // Máy cá nhân giữ riêng; máy của phòng máy mới để cả tổ chức thấy.
    expect(sent?.visibility).toBe('shared');
  });

  it('chưa gõ tên thì không tạo được', async () => {
    withRunners();
    const user = userEvent.setup();
    await renderWithRouter(<RunnerAdmin />);
    await user.click(await screen.findByRole('button', { name: /Thêm máy/ }));
    expect(screen.getByRole('button', { name: 'Tạo token' })).toBeDisabled();
  });

  it('đổi token thì hiện token mới, cũng chỉ một lần', async () => {
    withRunners(RUNNER);
    server.use(http.post(ROUTES.runnersRotate, () =>
      HttpResponse.json({ token: 'TOKEN-MOI' })));

    const user = userEvent.setup();
    await renderWithRouter(<RunnerAdmin />);
    await user.click(await screen.findByRole('button', { name: 'Đổi token' }));
    expect(await screen.findByText(/TOKEN-MOI/)).toBeInTheDocument();
  });

  it('máy đã thu hồi thì không còn nút nào', async () => {
    // Dòng Ở LẠI chứ không biến mất: `job.runner_id` trỏ vào nó, và "job này
    // chạy ở máy nào" là câu một cuộc điều tra sau sự cố cần.
    withRunners({ ...RUNNER, state: 'revoked' });
    await renderWithRouter(<RunnerAdmin />);

    const row = (await screen.findByText(RUNNER.name)).closest('tr')!;
    expect(within(row).getByText('đã thu hồi')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });
});
