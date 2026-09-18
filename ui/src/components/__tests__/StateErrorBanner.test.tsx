import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StateErrorBanner } from '../StateErrorBanner';
import { api } from '@/api/client';

/**
 * Một endpoint 500 phải hiện ra là 500, không được biến thành "0 kết quả".
 *
 * React Query giữ lại dữ liệu của lần gọi cuối thành công, nên khi `/api/state`
 * bắt đầu lỗi thì panel vẫn có `data` và vẫn vẽ bình thường. Đo 2026-09-16: một
 * element sinh mới trùng tên alias làm `Registry.load()` ném, `/api/state` trả
 * 500, và màn Kịch bản hiện "0 kịch bản khớp bộ lọc" — câu chữ của một bộ lọc
 * quá hẹp. Người dùng đi soi bộ lọc trong khi server đang hỏng.
 */
function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StateErrorBanner />
    </QueryClientProvider>,
  );
}

describe('StateErrorBanner', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('im lặng khi /api/state bình thường', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({} as never);
    const { container } = renderBanner();
    await vi.waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.querySelector('[data-state-error]')).toBeNull();
  });

  it('hiện lỗi và trích nguyên văn thông báo của server', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(
      new Error('Alias "Nút thêm mã cổ phiếu" của element "priceBoard.addStockButton" trùng…'),
    );
    renderBanner();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Máy chủ đang lỗi/);
    expect(alert.textContent).toMatch(/priceBoard\.addStockButton/);
  });

  /** Chốt câu chữ: phải nói rõ trống ≠ không có dữ liệu. */
  it('nói rõ màn hình trống không có nghĩa là không có dữ liệu', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'));
    renderBanner();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/KHÔNG phải là không có dữ liệu/);
  });
});
