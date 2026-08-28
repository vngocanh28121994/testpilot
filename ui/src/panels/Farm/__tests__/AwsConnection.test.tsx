import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import type { AwsStatus } from '@core/ui/contracts.js';
import { server } from '@/test/mocks/server';
import { awsFixtures } from '@/test/mocks/handlers/farm';
import { renderWithRouter } from '@/test/utils';
import { ROUTES } from '@/api/routes';
import FarmPanel from '@/panels/Farm';

/**
 * Thẻ "Kết nối AWS".
 *
 * Bug gốc: nút "Đăng nhập AWS" bị ẩn và màn hình không nói vì sao. Ba nguyên
 * nhân hoàn toàn khác nhau — chưa cài CLI, không có phiên nào để đăng nhập,
 * phiên hết hạn — đều hiện đúng một câu lỗi tiếng Anh của AWS SDK. Bộ test này
 * khoá lại sự khác biệt giữa chúng.
 */
async function render(status: AwsStatus) {
  server.use(http.get(ROUTES.aws, () => HttpResponse.json(status)));
  return renderWithRouter(<FarmPanel />, { path: '/farm' });
}

const loginButton = () => screen.queryByRole('button', { name: 'Đăng nhập AWS' });

describe('Kết nối AWS — vì sao không có nút đăng nhập', () => {
  it('chưa cài AWS CLI: nói ra điều đó và nêu đúng lệnh còn thiếu', async () => {
    await render(awsFixtures.cliMissing);

    expect(await screen.findByText(/Chưa tìm thấy AWS CLI v2 trên máy này/)).toBeInTheDocument();
    // Lệnh phải khớp CHÍNH XÁC thứ awsLogin() sẽ spawn, kể cả cờ --region.
    expect(screen.getByText('aws login --region us-west-2')).toBeInTheDocument();
    expect(loginButton()).not.toBeInTheDocument();
  });

  /**
   * Credential từ biến môi trường / IAM role: không có phiên nào để đăng nhập,
   * và một trình duyệt mở ra sẽ mở trên server chứ không phải ở đây.
   */
  it('không có phiên nào để đăng nhập: chỉ ra nguồn credential', async () => {
    await render(awsFixtures.noSession);

    expect(await screen.findByText(/không có phiên nào để đăng nhập/)).toBeInTheDocument();
    expect(screen.getByText('biến môi trường')).toBeInTheDocument();
    expect(loginButton()).not.toBeInTheDocument();
  });

  /**
   * Đây là hồi quy chính: profile SSO hết hạn PHẢI có nút đăng nhập. Trước khi
   * sửa, `canLogin` đòi source đúng bằng '~/.aws hoặc IAM role của máy', nên
   * mọi người dùng AWS_PROFILE — cách dựng IAM Identity Center phổ biến nhất —
   * không bao giờ thấy nút này.
   */
  it('phiên SSO hết hạn: hiện nút đăng nhập và nói ra lệnh sắp chạy', async () => {
    await render(awsFixtures.ready);

    expect(await screen.findByRole('button', { name: 'Đăng nhập AWS' })).toBeInTheDocument();
    expect(screen.getByText('aws sso login --profile tcbs')).toBeInTheDocument();
    // Bấm nhầm `aws login` thay vì `aws sso login` ghi đè cấu hình Identity
    // Center, nên lệnh phải hiện ra trước khi bấm chứ không phải sau.
    expect(screen.getByText(/cho profile “tcbs”/)).toBeInTheDocument();
  });
});

describe('Kết nối AWS — hạn dùng của credential', () => {
  /**
   * Một lượt farm chạy 20 phút với credential còn 7 phút sẽ chết giữa chừng,
   * SAU khi đã upload gói test và tiêu phút thiết bị. Bản React trước đây bỏ
   * hẳn con số này dù server vẫn gửi.
   */
  it('hiện nguồn, key hint và số phút còn lại', async () => {
    await render(awsFixtures.expiringSoon);

    const line = await screen.findByText(/Nguồn: profile "tcbs" · key ASIA… · còn 7 phút/);
    expect(line).toBeInTheDocument();
    // Dưới 15 phút thì đổi màu cảnh báo, cùng ngưỡng scheduler dùng.
    expect(line).toHaveClass('text-status-flaky');
  });

  it('access key tĩnh thì nói không hết hạn, không cảnh báo', async () => {
    await render(awsFixtures.stable);

    const line = await screen.findByText(
      /Nguồn: biến môi trường · key AKIA… · không hết hạn/,
    );
    expect(line).not.toHaveClass('text-status-flaky');
  });

  it('kết nối được thì không còn khối giải thích nào', async () => {
    await render(awsFixtures.stable);
    await screen.findByText(/không hết hạn/);

    expect(screen.queryByText(/Chưa tìm thấy AWS CLI/)).not.toBeInTheDocument();
    expect(screen.queryByText(/không có phiên nào để đăng nhập/)).not.toBeInTheDocument();
  });
});
