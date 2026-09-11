import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import { RunVideo } from '../RunVideo';

/**
 * Bản ghi màn hình mở ra ở giây 0 — tức lúc máy còn đang cài app. Dựng phiên
 * Appium mất khoảng mười tám giây trên máy thật, và suốt quãng đó màn hình
 * không liên quan gì tới bài test. Chạy nhiều kịch bản thì tất cả nằm trong MỘT
 * file, không có mốc nào để nhảy.
 *
 * Cả hai dữ liệu đều do server tính sẵn và gửi kèm report từ lâu — nhưng
 * contract không khai ba trường đó, nên giao diện không nhìn thấy và màn chi
 * tiết farm vẫn vẽ một thẻ <video> trần.
 */
const report = {
  wholeVideoUrls: ['/runs/x/artifacts/video/devicefarm-1.mp4'],
  testSeconds: 113.8,
  chapters: [
    { name: 'Đăng nhập thành công', status: 'passed', at: 0 },
    { name: 'Tìm kiếm Bảng giá', status: 'failed', at: 62.5 },
  ],
};

/** jsdom không có bộ giải mã, nên thời lượng phải tự đặt. */
function playerWithDuration(seconds: number) {
  const view = render(<RunVideo url={report.wholeVideoUrls[0]!} report={report} />);
  const el = view.container.querySelector('video')!;
  Object.defineProperty(el, 'duration', { value: seconds, configurable: true });
  el.play = vi.fn().mockResolvedValue(undefined);
  return { el, view };
}

describe('RunVideo', () => {
  it('nhảy qua đoạn cài đặt và nói đã bỏ qua bao nhiêu', () => {
    const { el } = playerWithDuration(150);
    act(() => { el.dispatchEvent(new Event('loadedmetadata')); });
    // 150 − 113,8 − 2 = 34,2 giây cài đặt
    expect(el.currentTime).toBeCloseTo(34.2, 1);
    expect(screen.getByText(/Đã bỏ qua 34 giây cài đặt/)).toBeInTheDocument();
  });

  /** Bản ghi ngắn hơn cả bài test thì không có gì để bỏ qua. */
  it('không nhảy khi không có đoạn cài đặt đáng kể', () => {
    const { el } = playerWithDuration(114);
    act(() => { el.dispatchEvent(new Event('loadedmetadata')); });
    expect(el.currentTime).toBe(0);
    expect(screen.queryByText(/Đã bỏ qua/)).not.toBeInTheDocument();
  });

  it('có mốc cho từng kịch bản, bấm là nhảy tới đúng chỗ', async () => {
    const user = userEvent.setup();
    const { el } = playerWithDuration(150);
    act(() => { el.dispatchEvent(new Event('loadedmetadata')); });
    await user.click(screen.getByRole('button', { name: /Tìm kiếm Bảng giá/ }));
    // Mốc tính từ lúc kịch bản đầu bắt đầu, nên phải cộng phần đã bỏ qua.
    expect(el.currentTime).toBeCloseTo(34.2 + 62.5, 1);
  });

  /**
   * Clip riêng của một kịch bản vốn đã bắt đầu ở đúng chỗ của nó — nhảy tiếp là
   * nhảy qua mất phần đầu.
   */
  it('clip riêng của một kịch bản thì không nhảy, không mốc', () => {
    const view = render(
      <RunVideo url="/runs/x/artifacts/video/scenario-2.mp4" report={report} />,
    );
    const el = view.container.querySelector('video')!;
    Object.defineProperty(el, 'duration', { value: 150, configurable: true });
    act(() => { el.dispatchEvent(new Event('loadedmetadata')); });
    expect(el.currentTime).toBe(0);
    expect(screen.queryByRole('button', { name: /Tìm kiếm Bảng giá/ })).not.toBeInTheDocument();
  });
});

/**
 * Bản ghi của điện thoại là khung dọc, nên `max-w-full` một mình cho ra một cột
 * cao gần bằng cả màn hình và đẩy phần còn lại của báo cáo xuống dưới tầm mắt.
 */
describe('RunVideo — khung dọc không được chiếm hết màn hình', () => {
  it('giới hạn theo chiều cao, vì video dọc thì chiều cao mới là cái tràn', () => {
    const { container } = render(<RunVideo url={report.wholeVideoUrls[0]!} report={report} />);
    expect(container.querySelector('video')!.className).toContain('max-h-');
  });
});
