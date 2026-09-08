import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { ScenarioEditor } from '../ScenarioEditor';

const BLOCK = ['@web', '  Scenario: Đăng nhập thành công', '    Given I open the app'].join('\n');

const open = (props: Partial<Parameters<typeof ScenarioEditor>[0]> = {}) =>
  renderWithProviders(
    <ScenarioEditor
      open
      title="Đăng nhập thành công"
      filename="dang-nhap.feature"
      block={BLOCK}
      tagSuggestions={['@smoke', '@regression']}
      saving={false}
      onSave={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />,
  );

const editor = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Nội dung kịch bản' });

describe('ScenarioEditor', () => {
  it('mở ra với đúng khối được đưa vào', () => {
    open();
    expect(editor().value).toBe(BLOCK);
    expect(screen.getByText('dang-nhap.feature')).toBeInTheDocument();
  });

  /**
   * Tab phải thụt lề chứ không nhảy ra khỏi ô. Trong một trình soạn Gherkin,
   * thụt lề là việc làm liên tục, còn rời ô là việc làm một lần lúc xong.
   */
  it('Tab thụt lề, Shift+Tab bỏ thụt lề', async () => {
    const user = userEvent.setup();
    open({ block: 'Scenario: X' });
    const area = editor();
    area.setSelectionRange(0, 0);
    await user.tab(); // focus vào ô trước
    area.focus();
    area.setSelectionRange(0, 0);
    await user.keyboard('{Tab}');
    expect(editor().value).toBe('  Scenario: X');

    editor().setSelectionRange(2, 2);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(editor().value).toBe('Scenario: X');
  });

  it('sửa tag bằng chip, không phải gõ tay vào Gherkin', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: '@smoke' }));
    expect(editor().value.split('\n')[0]).toBe('@web @smoke');

    await user.click(screen.getByRole('button', { name: 'Bỏ @web' }));
    expect(editor().value.split('\n')[0]).toBe('@smoke');
  });

  it('gửi đúng nội dung đang soạn khi bấm Lưu', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    open({ onSave });
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(onSave).toHaveBeenCalledWith(BLOCK);
  });

  /**
   * Bảng cú pháp có hơn ba mươi mẫu câu cộng toàn bộ element. Cuộn tay tìm một
   * câu rồi gõ lại nó cho đúng từng ký tự là cách chắc chắn để gõ sai.
   */
  it('tìm được trong bảng cú pháp và chèn câu vào kịch bản', async () => {
    const user = userEvent.setup();
    open();
    const search = await screen.findByRole('searchbox', { name: 'Tìm trong bảng cú pháp' });
    await user.type(search, 'tap');

    const suggestion = await screen.findByRole('button', { name: /I tap/ });
    editor().focus();
    editor().setSelectionRange(BLOCK.length, BLOCK.length);
    await user.click(suggestion);

    expect(editor().value.startsWith(BLOCK)).toBe(true);
    expect(editor().value.length).toBeGreaterThan(BLOCK.length);
    expect(editor().value).toContain('I tap');
  });
});
