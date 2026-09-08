import { describe, expect, it, vi } from 'vitest';
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

  /**
   * CLI in tên kịch bản hai lần — "… tên" lúc bắt đầu, "✓ tên" lúc xong. Hiện
   * cả hai thì một suite mười kịch bản đọc như hai mươi, và mắt phải tự ghép cặp.
   */
  it('thay dòng đang chạy bằng kết quả, ngay tại chỗ nó đứng', () => {
    const { rerender } = render(<LogView logs={['[run:running] … Đăng nhập']} />);
    expect(screen.getByText('… Đăng nhập').className).toContain('status-running');

    rerender(<LogView logs={['[run:running] … Đăng nhập', '[run:failed] ✗ Đăng nhập']} />);
    expect(screen.queryByText('… Đăng nhập')).not.toBeInTheDocument();
    expect(screen.getByText('✗ Đăng nhập').className).toContain('status-fail');
    expect(screen.getByRole('log').children).toHaveLength(1);
  });

  it('giữ nguyên thứ tự: kết quả nằm đúng chỗ dòng đang chạy, không nhảy xuống cuối', () => {
    render(
      <LogView
        logs={['[run:running] … A', '[run:running] … B', '[run:passed] ✓ A']}
      />,
    );
    const texts = [...screen.getByRole('log').children].map((c) => c.textContent);
    expect(texts).toEqual(['✓ A', '… B']);
  });

  it('dựng dòng tổng kết thay vì in nguyên văn', () => {
    render(<LogView logs={['[run:summary] 3✓ 4✗ 0~ 6⊘ 4✎']} />);
    expect(screen.queryByText(/run:summary/)).not.toBeInTheDocument();
    expect(screen.getByText('3 pass').className).toContain('status-pass');
    expect(screen.getByText('4 fail').className).toContain('status-fail');
    expect(screen.getByText('6 bỏ qua')).toBeInTheDocument();
    expect(screen.getByText('4 chưa duyệt')).toBeInTheDocument();
    // 0 flaky thì không chiếm chỗ.
    expect(screen.queryByText(/flaky/)).not.toBeInTheDocument();
  });

  /**
   * Device Farm in link artifact dài hàng trăm ký tự. Hiện nó dưới dạng chữ
   * chết nghĩa là bắt người ta chép tay.
   */
  it('biến URL thành link bấm được', () => {
    render(<LogView logs={['[run] report -> https://farm.example.com/a/b?token=xyz']} />);
    const link = screen.getByRole('link', { name: 'https://farm.example.com/a/b?token=xyz' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('giấu dòng [run:dir] vì đó là đường dẫn nội bộ, không phải câu cho người', () => {
    render(<LogView logs={['[run:dir] /tmp/runs/abc', 'đang chạy']} />);
    expect(screen.queryByText('/tmp/runs/abc')).not.toBeInTheDocument();
    expect(screen.getByText('đang chạy')).toBeInTheDocument();
  });

  /**
   * Khung tự cuộn mà nó lại nằm dưới màn hình thì người dùng vẫn không thấy gì.
   * Bản cũ kéo cả trang theo đúng bằng phần khung lòi ra ngoài; thiếu bước này
   * là log "không tự cuộn" theo đúng nghĩa người dùng cảm nhận.
   */
  it('kéo cả trang theo khi khung log nằm dưới màn hình', () => {
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const { rerender } = render(<LogView logs={logs(3)} />);
    const box = screen.getByRole('log');
    measure(box);
    // Khung lòi 200px ra khỏi đáy màn hình.
    box.getBoundingClientRect = () => ({ bottom: window.innerHeight + 200 }) as DOMRect;

    rerender(<LogView logs={logs(4)} />);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 208 }));
    vi.unstubAllGlobals();
  });

  it('không kéo trang khi khung đã nằm trọn trong màn hình', () => {
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const { rerender } = render(<LogView logs={logs(3)} />);
    const box = screen.getByRole('log');
    measure(box);
    box.getBoundingClientRect = () => ({ bottom: window.innerHeight - 50 }) as DOMRect;

    rerender(<LogView logs={logs(4)} />);
    expect(scrollBy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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
