import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LogView } from '../LogView';

/**
 * jsdom không bố cục thật nên mọi kích thước đều là 0. Đặt tay để phân biệt
 * được "đang ở cuối" với "đã cuộn lên" — thứ quyết định có bám đuôi hay không.
 */
function measure(el: HTMLElement, { scrollHeight = 500, clientHeight = 100 } = {}) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
}

const logs = (n: number) => Array.from({ length: n }, (_, i) => `dòng ${i + 1}`);

describe('LogView', () => {
  it('mỗi dòng là một dòng riêng, không phải một khối chữ dính liền', () => {
    render(<LogView logs={['a', 'b']} />);
    const box = screen.getByRole('log');
    expect(box.children).toHaveLength(2);
  });

  /**
   * Một lượt chạy đổ log trong nhiều phút. Không cuộn thì dòng mới nhất — thứ
   * duy nhất đáng nhìn — nằm ngoài màn hình suốt cả lượt chạy.
   */
  it('cuộn xuống dòng mới nhất khi có log mới', () => {
    const { rerender } = render(<LogView logs={logs(3)} />);
    const box = screen.getByRole('log');
    measure(box);
    box.scrollTop = 0;

    rerender(<LogView logs={logs(4)} />);
    expect(box.scrollTop).toBe(500);
  });

  /**
   * Nhưng cuộn lên đọc lại đoạn trước thì không được bị dòng mới kéo tuột
   * xuống — nếu không, không thể đọc lại một lỗi đã trôi qua trong khi lượt
   * chạy vẫn đang đổ log.
   */
  it('không kéo tuột xuống khi người đọc đã cuộn lên', () => {
    const { rerender } = render(<LogView logs={logs(3)} />);
    const box = screen.getByRole('log');
    measure(box);

    box.scrollTop = 10; // 500 - 10 - 100 = 390 > 24 ⇒ đã rời đuôi
    box.dispatchEvent(new Event('scroll', { bubbles: true }));

    rerender(<LogView logs={logs(4)} />);
    expect(box.scrollTop).toBe(10);
  });

  it('bám lại đuôi khi người đọc cuộn về cuối', () => {
    const { rerender } = render(<LogView logs={logs(3)} />);
    const box = screen.getByRole('log');
    measure(box);

    box.scrollTop = 10;
    box.dispatchEvent(new Event('scroll', { bubbles: true }));
    box.scrollTop = 400; // 500 - 400 - 100 = 0 ⇒ đã ở đuôi
    box.dispatchEvent(new Event('scroll', { bubbles: true }));

    rerender(<LogView logs={logs(4)} />);
    expect(box.scrollTop).toBe(500);
  });

  /**
   * CLI đã đánh dấu sẵn kết quả từng kịch bản. Bản trước in nguyên văn cái dấu
   * đó ra màn hình như một chuỗi rác, thay vì biến nó thành màu.
   */
  it('đổi marker của CLI thành màu, không in nguyên văn', () => {
    render(<LogView logs={['[run:passed] ✓ Đăng nhập', '[run:failed] ✗ Sai mật khẩu']} />);
    expect(screen.queryByText(/\[run:/)).not.toBeInTheDocument();

    expect(screen.getByText('✓ Đăng nhập').className).toContain('status-pass');
    expect(screen.getByText('✗ Sai mật khẩu').className).toContain('status-fail');
  });

  it('giấu dòng [run:dir] vì đó là đường dẫn nội bộ, không phải câu cho người', () => {
    render(<LogView logs={['[run:dir] /tmp/runs/abc', 'đang chạy']} />);
    expect(screen.queryByText('/tmp/runs/abc')).not.toBeInTheDocument();
    expect(screen.getByText('đang chạy')).toBeInTheDocument();
  });

  it('nói ra lỗi ở cuối log thay vì để im', () => {
    render(<LogView logs={['a']} error="Appium chết giữa chừng." />);
    expect(screen.getByText('Appium chết giữa chừng.')).toBeInTheDocument();
  });

  it('nói khi đã cắt bớt dòng đầu', () => {
    render(<LogView logs={['a']} dropped={120} />);
    expect(screen.getByText(/Đã ẩn 120 dòng đầu/)).toBeInTheDocument();
  });
});
