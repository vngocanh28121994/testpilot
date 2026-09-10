/**
 * Nút chữa nằm cạnh dòng hỏng, không nằm ở một màn hình.
 *
 * Bản đầu tôi để nút bật tunnel trong PrereqTools — mà PrereqTools chỉ có ở màn
 * Local Runner. Chạy workflow thì màn Studio nói đúng lý do dừng ("Tunnel cho
 * WebView … chưa chạy") nhưng không có chỗ nào bấm để chữa: người dùng phải tự
 * nghĩ ra là mở sang màn khác. Gắn nút vào chính dòng kiểm tra thì nó theo dữ
 * liệu sang mọi màn hình đang hiển thị kết quả.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { PreflightChecks } from '../PreflightChecks';

const tunnelDown = {
  name: 'Tunnel cho WebView (iOS 17+)',
  ok: false,
  fix: 'ios-tunnel' as const,
  detail: 'Chưa chạy lần nào.',
};

describe('dòng kiểm tra tunnel', () => {
  it('kèm nút mở Terminal ở bất cứ màn hình nào dựng nó', () => {
    renderWithProviders(<PreflightChecks checks={[tunnelDown]} />);
    expect(screen.getByRole('button', { name: /Mở Terminal và chạy/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Chép lệnh/ })).toBeInTheDocument();
  });

  it('không hỏi mật khẩu máy', () => {
    renderWithProviders(<PreflightChecks checks={[tunnelDown]} />);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('đạt rồi thì không còn nút nào', () => {
    renderWithProviders(
      <PreflightChecks checks={[{ ...tunnelDown, ok: true, detail: 'Đang chạy ở 127.0.0.1:52001.' }]} />,
    );
    expect(screen.queryByRole('button', { name: /Mở Terminal/ })).not.toBeInTheDocument();
  });
});
