/**
 * Màn thiết bị & hàng đợi.
 *
 * Thứ đáng đo ở đây là PHÉP GHÉP, không phải cách vẽ: màn hình nối ba nguồn
 * bằng `deviceId` và `jobId`, và phép nối ấy hỏng im lặng — bảng vẫn vẽ ra,
 * chỉ là mọi máy đều "rảnh" trong khi thật ra có người đang cầm.
 */
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';
import { ROUTES } from '@/api/routes';
import DevicesPanel from '@/panels/Devices';

const DEVICE = {
  platform: 'android' as const,
  udid: 'emulator-5554',
  label: 'Pixel 7 · Android 16 · emulator',
};

function lease(holder: unknown, id = 'lease-1') {
  return {
    id,
    deviceId: 'emulator-5554',
    holder,
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 42_000).toISOString(),
  };
}

const JOB = {
  id: 'job-1',
  kind: 'run_suite',
  state: 'running' as const,
  platform: 'android',
  tag: '@smoke',
  devices: ['android:emulator-5554'],
  requestedAt: new Date().toISOString(),
  attempt: 1,
};

function mock(options: { devices?: unknown[]; leases?: unknown[]; jobs?: unknown[] }) {
  server.use(
    http.get(ROUTES.deviceTargets, () => HttpResponse.json({ devices: options.devices ?? [] })),
    http.get(ROUTES.deviceLeases, () => HttpResponse.json({ leases: options.leases ?? [] })),
    http.get(ROUTES.jobs, () => HttpResponse.json({ jobs: options.jobs ?? [] })),
  );
}

/**
 * Render kèm Router thật: AppShell dùng `useRouterState`, nên render trần chỉ
 * cho ra "Cannot read properties of null (reading 'isServer')" — một thông báo
 * không chỉ ra được nguyên nhân.
 */
const show = () => renderWithRouter(<DevicesPanel />, { path: '/devices' });

describe('màn thiết bị', () => {
  it('dùng cùng hình dạng cache thiết bị với Local Runner và Workflow', async () => {
    mock({ devices: [DEVICE] });
    const { queryClient } = await show();

    // Mô phỏng người dùng vừa đi từ một màn khác sang. Hai màn kia lưu nguyên
    // response vào đúng queryKey này; đây từng là nguyên nhân lỗi `.filter is
    // not a function` xuất hiện tuỳ theo thứ tự mở màn hình.
    queryClient.setQueryData(['device-targets'], { devices: [DEVICE] });

    expect(await screen.findByText(DEVICE.label)).toBeInTheDocument();
  });

  it('máy không ai giữ thì nói là không ai', async () => {
    mock({ devices: [DEVICE] });
    await show();

    const row = await screen.findByText(DEVICE.label);
    expect(within(row.closest('tr')!).getByText('không ai')).toBeInTheDocument();
  });

  /** Phép ghép thứ nhất: lease → người. */
  it('người đang điều khiển thì hiện tên người ấy — không phải mã người dùng', async () => {
    mock({
      devices: [DEVICE],
      leases: [{ ...lease({ kind: 'human', userId: '597d89e8-7791' }), holderLabel: 'an@congty.vn' }],
    });
    await show();

    const row = (await screen.findByText(DEVICE.label)).closest('tr')!;
    expect(within(row).getByText('an@congty.vn')).toBeInTheDocument();
    expect(within(row).queryByText(/597d89e8/)).not.toBeInTheDocument();
    expect(within(row).queryByText('không ai')).not.toBeInTheDocument();
  });

  /** Phép ghép thứ hai: lease → job → tag của job. */
  it('job đang chạy thì hiện việc mà job ấy làm', async () => {
    mock({
      devices: [DEVICE],
      leases: [lease({ kind: 'job', jobId: 'job-1' })],
      jobs: [JOB],
    });
    await show();

    const row = (await screen.findByText(DEVICE.label)).closest('tr')!;
    expect(within(row).getByText(/job đang chạy/)).toBeInTheDocument();
    expect(within(row).getByText('@smoke')).toBeInTheDocument();
  });

  it('chưa máy nào cắm thì nói rõ job sẽ CHỜ, không hỏng', async () => {
    mock({});
    await show();
    expect(await screen.findByText(/sẽ nằm chờ/)).toBeInTheDocument();
  });
});

describe('thu hồi thiết bị', () => {
  /**
   * Lý do là bắt buộc ở server, nên nút xác nhận phải khoá tới khi có lý do —
   * nếu không, người dùng bấm rồi nhận một lỗi 400 không giải thích gì.
   */
  it('chưa nhập lý do thì chưa xác nhận được', async () => {
    mock({ devices: [DEVICE], leases: [lease({ kind: 'human', userId: 'an' })] });
    await show();

    await userEvent.click(await screen.findByRole('button', { name: 'Thu hồi' }));
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Lý do thu hồi'), 'máy treo');
    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeEnabled();
  });

  it('gửi đúng leaseId và lý do', async () => {
    mock({ devices: [DEVICE], leases: [lease({ kind: 'human', userId: 'an' })] });
    let sent: unknown;
    server.use(
      http.post(ROUTES.deviceLeaseForceRelease, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    await show();

    await userEvent.click(await screen.findByRole('button', { name: 'Thu hồi' }));
    await userEvent.type(screen.getByLabelText('Lý do thu hồi'), 'máy treo từ hôm qua');
    await userEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));

    await waitFor(() => expect(sent).toEqual({
      leaseId: 'lease-1', reason: 'máy treo từ hôm qua',
    }));
  });

  it('bấm Thôi thì không gửi gì', async () => {
    mock({ devices: [DEVICE], leases: [lease({ kind: 'human', userId: 'an' })] });
    const posted = vi.fn();
    server.use(
      http.post(ROUTES.deviceLeaseForceRelease, () => { posted(); return HttpResponse.json({}); }),
    );
    await show();

    await userEvent.click(await screen.findByRole('button', { name: 'Thu hồi' }));
    await userEvent.click(screen.getByRole('button', { name: 'Thôi' }));

    expect(screen.queryByLabelText('Lý do thu hồi')).not.toBeInTheDocument();
    expect(posted).not.toHaveBeenCalled();
  });
});

describe('hàng đợi', () => {
  it('chia theo đang chạy, đang chờ, vừa xong', async () => {
    mock({
      jobs: [
        JOB,
        { ...JOB, id: 'job-2', state: 'queued', tag: '@p0', error: 'Máy đang bận.' },
        { ...JOB, id: 'job-3', state: 'failed', tag: '@cu' },
      ],
    });
    await show();

    // Chờ DỮ LIỆU, không chờ tiêu đề: tiêu đề có sẵn từ lần render đầu, nên
    // `findByRole('heading')` trả về ngay khi bảng còn rỗng.
    await screen.findByText(/@smoke/);
    // Mỗi khối là một `Card` dùng chung, gắn với tiêu đề bằng `aria-labelledby`.
    // `CardTitle` của shadcn là một `div`, không phải thẻ heading — nên tìm
    // theo CHỮ, không theo vai trò.
    const cardOf = (title: string) =>
      screen.getByText(title, { selector: '[data-slot="card-title"]' })
        .closest<HTMLElement>('[aria-labelledby]')!;

    expect(within(cardOf('Đang chạy')).getByText(/@smoke/)).toBeInTheDocument();

    const waitingList = cardOf('Đang chờ');
    expect(within(waitingList).getByText(/@p0/)).toBeInTheDocument();
    // Lý do chờ phải hiện ra: một job im lặng nhìn giống một job bị treo.
    expect(within(waitingList).getByText('Máy đang bận.')).toBeInTheDocument();

    expect(within(cardOf('Vừa xong')).getByText(/@cu/)).toBeInTheDocument();
  });

  it('job thử lại nhiều lần thì nói lần thứ mấy', async () => {
    mock({ jobs: [{ ...JOB, state: 'queued', attempt: 3 }] });
    await show();
    expect(await screen.findByText(/lần 3/)).toBeInTheDocument();
  });
});

/**
 * Hướng dẫn cắm máy mới phải tự MỞ khi có việc, và tự mở đúng tab: người vừa
 * cắm một chiếc iPhone chưa bấm Tin cậy không nên phải tìm tab iPhone.
 */
describe('thẻ Cắm máy mới', () => {
  const guide = () => screen.findByRole('button', { name: /Cắm máy mới/ });

  it('chưa máy nào cắm thì mở sẵn, ở tab Android', async () => {
    mock({});
    await show();
    await waitFor(async () => expect(await guide()).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('tab', { name: 'Android' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Bật Gỡ lỗi USB')).toBeInTheDocument();
  });

  it('iPhone cắm mà chưa dùng được thì mở sẵn ở tab iPhone, kèm số máy', async () => {
    mock({ devices: [DEVICE, {
      platform: 'ios', udid: '00008101-AAAA', label: 'iPhone 15',
      unavailable: 'iPhone chưa tin cậy máy tính này.',
    }] });
    await show();
    await waitFor(async () => expect(await guide()).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('tab', { name: 'iPhone / iPad' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/1 máy đang cắm mà chưa dùng được/)).toBeInTheDocument();
    expect(screen.getByText('Tin cậy chứng chỉ nhà phát triển')).toBeInTheDocument();
  });

  it('mọi máy đều dùng được thì gập lại, bấm là mở', async () => {
    mock({ devices: [DEVICE] });
    await show();
    await screen.findByText(DEVICE.label);
    expect(await guide()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Bật Gỡ lỗi USB')).not.toBeInTheDocument();

    await userEvent.click(await guide());
    expect(screen.getByText('Bật Gỡ lỗi USB')).toBeInTheDocument();
  });
});
