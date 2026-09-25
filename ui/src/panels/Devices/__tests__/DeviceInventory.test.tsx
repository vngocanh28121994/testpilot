import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/utils';
import { DeviceInventory } from '../DeviceInventory';

const DEVICES = [
  { platform: 'android' as const, udid: 'pixel', label: 'Pixel 7', runnerName: 'Máy chủ' },
  { platform: 'ios' as const, udid: 'iphone', label: 'iPhone 12', runnerName: 'Máy chủ' },
];
const LEASES = [{
  id: 'l1', deviceId: 'iphone', holder: { kind: 'human' as const, userId: 'u1' },
  holderLabel: 'an@congty.vn', acquiredAt: '', expiresAt: '',
}];

describe('DeviceInventory', () => {
  it('bấm "Rảnh" chỉ còn máy rảnh, kèm nút Điều khiển; tiêu đề nhóm đếm rảnh/tổng', async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <DeviceInventory
        devices={DEVICES}
        leases={LEASES}
        jobById={() => undefined}
        secondsLeft={() => 30}
        renderReclaim={() => null}
      />,
    );
    expect(await screen.findByText('· 1/2 rảnh')).toBeInTheDocument();
    expect(screen.getByText('iPhone 12')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Rảnh/ }));
    expect(screen.queryByText('iPhone 12')).not.toBeInTheDocument();
    expect(screen.getByText('Pixel 7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Điều khiển/ })).toBeInTheDocument();
  });
});
