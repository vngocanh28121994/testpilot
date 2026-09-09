import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import HistoryPanel from '@/panels/History';

/**
 * Danh sách lịch sử phải quét được bằng mắt.
 *
 * Mỗi lượt chạy workflow có 11 bước, và trước đây cả 11 được trải ra trên mọi
 * thẻ. Mười lượt là hơn trăm dòng lặp đúng những cái tên ấy, nên thứ người ta
 * thật sự tới đây để tìm — lượt nào hỏng, hỏng ở đâu — chìm mất.
 */
const render = () => renderWithRouter(<HistoryPanel />, { path: '/scenarios/history' });

describe('thẻ lịch sử workflow', () => {
  it('danh sách bước gấp lại, không trải sẵn', async () => {
    await render();
    const summary = await screen.findAllByText(/Tiến trình \(\d+ bước\)/);
    expect(summary.length).toBeGreaterThan(0);
    const details = summary[0]!.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  });

  it('mở ra thì thấy đủ các bước', async () => {
    const user = userEvent.setup();
    await render();
    const summary = (await screen.findAllByText(/Tiến trình \(\d+ bước\)/))[0]!;
    await user.click(summary);
    const details = summary.closest('details')!;
    expect(within(details).getByText('Đọc tài liệu')).toBeInTheDocument();
  });

  /**
   * Câu hỏi mang tới trang này là "lượt này đi tới đâu thì hỏng". Câu trả lời
   * không được nằm sau một lần bấm, cũng không được bắt người đọc dò tìm dấu ✗.
   */
  it('nói ngay bước dừng lại mà không phải mở gì', async () => {
    await render();
    await screen.findAllByText(/Tiến trình/);
    // Chuỗi bị tách làm hai thẻ (nhãn + tên bước được nhấn), nên phải so trên
    // textContent của cả phần tử thay vì để matcher mặc định tìm từng thẻ.
    const line = screen.getByText(
      (_, el) => el?.tagName === 'P' && /^Dừng ở: AI phân tích yêu cầu$/.test(el.textContent ?? ''),
    );
    expect(line).toBeInTheDocument();
  });
});
