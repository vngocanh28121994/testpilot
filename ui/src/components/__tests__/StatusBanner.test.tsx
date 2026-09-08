import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBanner } from '../StatusBanner';

/**
 * Bản React đặt một huy hiệu nhỏ cạnh một câu chữ xám: muốn biết đang ổn hay
 * sắp hỏng thì phải đọc chữ trong huy hiệu, mà nó chỉ to bằng cỡ chữ phụ. Bản
 * cũ tô CẢ BĂNG — viền trái đậm, nền nhạt cùng tông — nên trạng thái đọc được
 * từ xa.
 */
describe('StatusBanner', () => {
  const box = (container: HTMLElement) => container.firstElementChild as HTMLElement;

  it('cả băng mang màu trạng thái, không chỉ một huy hiệu', () => {
    const { container } = render(<StatusBanner tone="pass" title="Kết nối được" />);
    expect(box(container).className).toContain('border-s-status-pass');
    expect(box(container).className).toContain('tint-pass');
  });

  it('mỗi trạng thái một màu riêng', () => {
    const tones = ['pass', 'warn', 'fail', 'unknown'] as const;
    const seen = tones.map((tone) => {
      const { container, unmount } = render(<StatusBanner tone={tone} title="x" />);
      const cls = box(container).className;
      unmount();
      return cls;
    });
    expect(new Set(seen).size).toBe(tones.length);
  });

  /**
   * Cái chấm lặp lại đúng nghĩa của màu, cho người không phân biệt được màu —
   * ghi chú trong CSS của bản cũ nói thẳng điều đó.
   */
  it('có chấm màu, và nó bị ẩn khỏi trình đọc màn hình vì chỉ lặp lại nghĩa', () => {
    const { container } = render(<StatusBanner tone="warn" title="Sắp hết hạn" />);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot?.className).toContain('bg-status-flaky');
  });

  it('tiêu đề in đậm, chi tiết nối sau trong cùng một câu', () => {
    render(<StatusBanner tone="pass" title="Kết nối được" detail="còn 6 giờ" />);
    expect(screen.getByText('Kết nối được').tagName).toBe('B');
    expect(screen.getByText(/còn 6 giờ/)).toBeInTheDocument();
  });

  it('không có chi tiết thì không để lại dấu gạch cụt lủn', () => {
    render(<StatusBanner tone="pass" title="Kết nối được" />);
    expect(screen.queryByText(/—/)).not.toBeInTheDocument();
  });
});
