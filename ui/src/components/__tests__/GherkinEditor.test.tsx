import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { GherkinEditor } from '../GherkinEditor';

const CONTENT = ['@smoke', 'Scenario: Chuyển tiền', '  Given I open the app', '', '  # ghi chú'].join('\n');

const setup = (value = CONTENT) => {
  const onChange = vi.fn();
  const view = render(
    <GherkinEditor value={value} onChange={onChange} aria-label="Nội dung kịch bản" />,
  );
  return { ...view, onChange };
};

const area = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Nội dung kịch bản' });

describe('GherkinEditor', () => {
  /**
   * Vẫn là một <textarea> thật, không phải contenteditable. Đây là thứ giữ cho
   * con trỏ của hệ điều hành, bộ gõ tiếng Việt, hoàn tác và trình đọc màn hình
   * hoạt động — và giữ cho mọi code chèn-tại-con-trỏ đã viết trước đó còn dùng được.
   */
  it('vẫn là textarea, gõ được như thường', async () => {
    const user = userEvent.setup();
    const { onChange } = setup('');
    expect(area().tagName).toBe('TEXTAREA');
    await user.type(area(), 'X');
    expect(onChange).toHaveBeenCalledWith('X');
  });

  it('đánh số dòng theo đúng số dòng thật, kể cả dòng trống', () => {
    const { container } = setup();
    const gutter = container.querySelector('[aria-hidden="true"]');
    expect(gutter?.textContent).toBe('12345');
  });

  /**
   * Lớp tô màu nằm dưới textarea và phải khớp từng ký tự. Nếu chữ của hai lớp
   * khác nhau thì màu trôi khỏi chữ, và càng xuống dưới càng lệch.
   */
  it('lớp tô màu chứa đúng nội dung của ô soạn', () => {
    const { container } = setup();
    const pre = container.querySelector('pre');
    // Dòng rỗng được thay bằng một ký tự xuống dòng để vẫn chiếm chỗ.
    expect(pre?.textContent?.replace(/\n/g, '')).toBe(CONTENT.replace(/\n/g, ''));
  });

  it('tô từ khoá bằng lớp màu riêng, không phải màu chữ thường', () => {
    const { container } = setup();
    const pre = container.querySelector('pre')!;
    const spanFor = (text: string) =>
      [...pre.querySelectorAll('span')].find((s) => s.textContent === text);

    expect(spanFor('Scenario:')?.className).toContain('gk-heading');
    expect(spanFor('Given')?.className).toContain('gk-step');
    expect(spanFor('@smoke')?.className).toContain('gk-tag');
    expect(spanFor('  # ghi chú')?.className).toContain('gk-comment');
  });

  it('lớp tô màu bị ẩn khỏi trình đọc màn hình', () => {
    const { container } = setup();
    expect(container.querySelector('pre')).toHaveAttribute('aria-hidden', 'true');
  });
});
