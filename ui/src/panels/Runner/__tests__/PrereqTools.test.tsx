import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { useJobStore } from '@/stores/jobStore';
import { PrereqTools } from '../PrereqTools';

/**
 * Trước đây đây là một thẻ riêng đứng cạnh thẻ preflight, và cả hai cùng liệt
 * kê Appium, thiết bị, driver — bằng hai cách vẽ khác nhau, trong đó chỉ một
 * cái thật sự khoá nút chạy. Nay chỉ còn phần hành động; kết luận "chạy được
 * chưa" chỉ có đúng một chỗ nói.
 */
describe('PrereqTools', () => {
  it('không lặp lại kết luận của preflight', () => {
    renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.queryByText(/Đủ điều kiện chạy|Sẵn sàng chạy/)).not.toBeInTheDocument();
    expect(screen.queryByText('Đạt')).not.toBeInTheDocument();
  });

  it('cài đúng driver theo nền tảng', () => {
    const { unmount } = renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.getByRole('button', { name: 'Cài driver uiautomator2' })).toBeInTheDocument();
    unmount();

    renderWithProviders(<PrereqTools platform="ios" />);
    expect(screen.getByRole('button', { name: 'Cài driver xcuitest' })).toBeInTheDocument();
  });

  it('chỉ hỏi Xcode trên iOS', () => {
    const { unmount } = renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.queryByRole('button', { name: 'Kiểm tra Xcode' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<PrereqTools platform="ios" />);
    expect(screen.getByRole('button', { name: 'Kiểm tra Xcode' })).toBeInTheDocument();
  });

  /**
   * Câu lệnh tương đương hiện ra để việc màn hình vừa làm là thứ kiểm chứng lại
   * được, chứ không phải một hộp đen bấm rồi tin.
   */
  it('hiện câu lệnh tương đương của mỗi hành động', () => {
    renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.getByText('appium driver install uiautomator2')).toBeInTheDocument();
  });

  it('nói rõ lý do khi Xcode chưa dùng được', async () => {
    server.use(
      http.get(ROUTES.prereqXcode, () =>
        HttpResponse.json({ ok: false, reason: 'Mới chỉ có Command Line Tools.' }),
      ),
    );
    renderWithProviders(<PrereqTools platform="ios" />);
    expect(await screen.findByText('Mới chỉ có Command Line Tools.')).toBeInTheDocument();
  });

  /**
   * Khởi động lại phải bấm được cả khi Appium đang chạy — đó chính là lúc cần
   * nó, một Appium còn sống nhưng đã treo phiên cũ.
   */
  it('luôn cho khởi động lại Appium', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PrereqTools platform="android" />);
    const button = screen.getByRole('button', { name: 'Khởi động lại Appium' });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(useJobStore.getState().jobs['prereq-appium-restart']).toBeDefined();
  });
});

/**
 * Khu này là một TRÌNH TỰ, không phải một rổ nút. Không có Xcode thì không
 * build được WebDriverAgent, nên mọi bước sau chưa kiểm được — và ba thiết lập
 * trên chính cái điện thoại là lý do thường gặp nhất khiến một bộ cài đúng vẫn
 * hỏng, trong khi không lệnh nào ở đây đọc lại được chúng.
 */
describe('hướng dẫn từng bước', () => {
  it('iOS mở đầu bằng Xcode', () => {
    renderWithProviders(<PrereqTools platform="ios" />);
    const steps = screen.getAllByText(/^[1-9]$/).map((el) => el.parentElement?.textContent ?? '');
    expect(steps[0]).toMatch(/Xcode/);
  });

  it('iOS có khối chuẩn bị trên máy, kèm đường dẫn Cài đặt', () => {
    renderWithProviders(<PrereqTools platform="ios" />);
    expect(screen.getByText(/Chuẩn bị trên chính iPhone/)).toBeInTheDocument();
    // Đường dẫn Cài đặt nằm trong span riêng để in đậm được, nên khớp theo
    // textContent của cả phần tử thay vì để matcher mặc định dò từng thẻ.
    const has = (re: RegExp) =>
      screen.getAllByText((_, el) => Boolean(el?.textContent && re.test(el.textContent))).length > 0;
    expect(has(/Quyền riêng tư & Bảo mật › Chế độ nhà phát triển/)).toBe(true);
    expect(has(/Safari › Nâng cao › Web Inspector/)).toBe(true);
  });

  /** Android không có Xcode lẫn ba thiết lập kia — nêu ra là nhiễu. */
  it('Android không hiện phần riêng của iOS', () => {
    renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.queryByText(/Chuẩn bị trên chính iPhone/)).toBeNull();
    expect(screen.queryByText(/xcodebuild/)).toBeNull();
  });

  /**
   * Không có nút chạy tunnel, và đó là chủ ý: lệnh cần sudo. Thứ giao diện phải
   * làm được là đưa đúng lệnh ra màn hình — thiếu nó thì người dùng không có
   * đường nào tự dựng tunnel ngoài việc đi đọc log Appium.
   */
  it('đưa ra lệnh dựng tunnel cho iOS', () => {
    renderWithProviders(<PrereqTools platform="ios" />);
    expect(screen.getByText('sudo appium driver run xcuitest tunnel-creation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chép lệnh' })).toBeInTheDocument();
  });

  /**
   * Nút mở Terminal, và KHÔNG có ô mật khẩu nào.
   *
   * Cách làm hiển nhiên hơn là hỏi mật khẩu máy ngay trên giao diện rồi đẩy vào
   * `sudo`. Nó bị bỏ có chủ đích: mật khẩu sẽ đi qua trình duyệt, qua HTTP, rồi
   * qua một tiến trình đang ghi 8.000 dòng log xuống đĩa, trên một server không
   * có xác thực. Test này giữ chủ đích đó, vì người sửa sau sẽ thấy việc thêm ô
   * mật khẩu là một cải tiến.
   */
  it('mở Terminal thay vì hỏi mật khẩu máy', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PrereqTools platform="ios" />);

    expect(screen.queryByLabelText(/mật khẩu/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Mở Terminal và chạy' }));
    expect(await screen.findByRole('button', { name: 'Mở Terminal và chạy' })).toBeEnabled();
  });

  it('không hỏi tunnel khi chạy Android', () => {
    renderWithProviders(<PrereqTools platform="android" />);
    expect(screen.queryByText(/tunnel-creation/)).not.toBeInTheDocument();
  });

  it('các bước được đánh số liên tiếp', () => {
    renderWithProviders(<PrereqTools platform="ios" />);
    const numbers = screen.getAllByText(/^[1-9]$/).map((el) => Number(el.textContent));
    // Bất biến là LIÊN TIẾP, không phải một con số cụ thể: chốt cứng độ dài thì
    // mỗi lần thêm một bước chính đáng lại phải sửa test, và người sửa dễ tay
    // đôi chỉnh luôn con số thay vì nhìn xem thứ tự có còn đúng không.
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    expect(numbers.length).toBeGreaterThanOrEqual(5);
  });
});
