import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { NormalizePanel } from '../NormalizePanel';
import { SyntaxHelp } from '../SyntaxHelp';

const empty = {
  content: '',
  changes: [],
  unresolved: [],
  valid: true,
  usedAi: false,
  discoveredLater: [],
  actionProposals: [],
  appliedActions: [],
  actionAnalysis: { available: true, attempted: false },
};

const normalizeReturns = (over: Record<string, unknown>) =>
  http.post(ROUTES.featureNormalize, () => HttpResponse.json({ ...empty, ...over }));

/**
 * Kịch bản viết bằng một tập mẫu câu đóng. Không có bước chuẩn hoá thì một câu
 * sai cú pháp chỉ lộ ra lúc chạy — sau khi đã duyệt và đã khởi động thiết bị.
 */
describe('NormalizePanel', () => {
  it('đưa nội dung đã chuẩn hoá về ô soạn', async () => {
    const onApply = vi.fn();
    server.use(normalizeReturns({ content: 'Then I tap "Nút đăng nhập"' }));
    renderWithProviders(<NormalizePanel content='Then bấm nút Đăng nhập' onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chuẩn hoá' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('Then I tap "Nút đăng nhập"'));
  });

  it('chỉ rõ số dòng của câu chưa chạy được', async () => {
    server.use(normalizeReturns({ unresolved: [{ line: 7, text: 'kiểm tra số dư đúng' }] }));
    renderWithProviders(<NormalizePanel content="x" onApply={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chuẩn hoá' }));
    expect(await screen.findByText(/Chưa chạy được 1 câu/)).toBeInTheDocument();
    expect(screen.getByText(/dòng 7:/)).toBeInTheDocument();
  });

  /**
   * `primitive` là action cần driver có capability mới. Duyệt nó là tạo ra một
   * mẫu câu gõ được nhưng chạy sẽ hỏng, nên nút phải chặn chứ không chỉ đổi chữ.
   */
  it('không cho duyệt action mà driver chưa chạy được', async () => {
    server.use(
      normalizeReturns({
        actionProposals: [
          {
            id: 'a1',
            label: 'Lắc máy',
            kind: 'primitive',
            status: 'pending',
            phraseTemplate: 'I shake the device',
            parameters: [],
            expansion: [],
            sourceExample: 'lắc máy',
            createdAt: '2026-09-06T00:00:00.000Z',
          },
        ],
      }),
    );
    renderWithProviders(<NormalizePanel content="x" onApply={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chuẩn hoá' }));
    expect(await screen.findByRole('button', { name: 'Cần adapter' })).toBeDisabled();
  });

  it('gửi đúng quyết định khi duyệt một action chạy được', async () => {
    let sent: unknown = null;
    server.use(
      normalizeReturns({
        actionProposals: [
          {
            id: 'a2',
            label: 'Đăng nhập nhanh',
            kind: 'macro',
            status: 'pending',
            phraseTemplate: 'I log in as "<user>"',
            parameters: [],
            expansion: ['I tap "Nút đăng nhập"'],
            sourceExample: 'đăng nhập',
            createdAt: '2026-09-06T00:00:00.000Z',
          },
        ],
      }),
      http.post(ROUTES.actionsReview, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ action: {}, actions: [] });
      }),
    );
    renderWithProviders(<NormalizePanel content="x" onApply={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chuẩn hoá' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Duyệt action' }));
    await waitFor(() => expect(sent).toEqual({ id: 'a2', decision: 'approve' }));
  });
});

describe('SyntaxHelp', () => {
  /**
   * Bảng bị bóp về gần bằng 0 và biến mất.
   *
   * Khung cha là một cột cuộn cao cố định, trong đó thẻ tag, ô Gherkin `h-80`
   * và bảng Chuẩn hoá đều không co được — nên flexbox dồn toàn bộ phần thiếu
   * chỗ vào bảng này, thứ duy nhất mang `min-h-0`. Người dùng chỉ còn thấy một
   * ô tìm kiếm không bao giờ ra kết quả, và mất luôn đường tra mẫu câu.
   */
  it('không được phép co mất, dù khung cha thiếu chỗ', async () => {
    const { container } = renderWithProviders(<SyntaxHelp />);
    // Lúc đang tải nó chỉ là một dòng chữ; đợi bảng thật hiện ra rồi mới hỏi.
    await screen.findByText('Thao tác');
    assertShrinkProof(container.querySelector('div'));
  });

  it('liệt kê mẫu câu theo nhóm và element gọi tên được', async () => {
    renderWithProviders(<SyntaxHelp />);
    expect(await screen.findByText('Thao tác')).toBeInTheDocument();
    expect(screen.getByText('I tap "<element>"')).toBeInTheDocument();
    expect(screen.getByText('Bấm vào một nút hoặc một dòng.')).toBeInTheDocument();
    expect(screen.getByText('Nút đăng nhập')).toBeInTheDocument();
  });
});

/** `min-h-0` ở gốc bảng cú pháp là đúng thứ đã làm nó biến mất. */
function assertShrinkProof(root: Element | null): void {
  expect(root).not.toBeNull();
  expect(root!.className).toContain('shrink-0');
  expect(root!.className).not.toContain('min-h-0');
}
