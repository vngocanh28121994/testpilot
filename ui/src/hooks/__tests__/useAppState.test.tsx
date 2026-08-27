import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { server } from '@/test/mocks/server';
import { createQueryWrapper } from '@/test/utils';
import { stateFixture } from '@/test/mocks/fixtures';
import { useAccounts, useAppState, useElementCount } from '@/hooks/useAppState';
import { ROUTES } from '@/api/routes';

describe('useAppState', () => {
  it('cắt lát dữ liệu bằng select', async () => {
    const wrapper = createQueryWrapper();
    const { result } = renderHook(() => useElementCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(106);
  });

  it('gọi /api/state đúng một lần cho nhiều lát cắt cùng lúc', async () => {
    let hits = 0;
    server.use(
      http.get(ROUTES.state, () => {
        hits++;
        return HttpResponse.json(stateFixture);
      }),
    );
    const wrapper = createQueryWrapper();
    const { result } = renderHook(
      () => ({ a: useElementCount(), b: useAccounts() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.a.isSuccess && result.current.b.isSuccess).toBe(true));
    // Cùng queryKey ['state'] ⇒ một request, hai lát cắt. Đây là cả lý do §6.7
    // tồn tại: bản cũ gọi refresh() rồi vẽ lại 6 panel mỗi lần.
    expect(hits).toBe(1);
  });

  /**
   * Điểm mấu chốt của §6.7: `select` + structuralSharing phải cắt được
   * re-render, nếu không thì cách làm này chỉ tốn thêm một lượt reconcile so
   * với việc đọc thẳng cả `state`.
   */
  it('lát cắt không đổi thì không tính lại', async () => {
    const wrapper = createQueryWrapper();
    const select = vi.fn((s: typeof stateFixture) => s.elements);
    const { result, rerender } = renderHook(() => useAppState(select), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const before = select.mock.calls.length;
    rerender();
    rerender();
    expect(result.current.data).toBe(106);
    // React Query memo hoá theo tham chiếu dữ liệu; rerender suông không được
    // kéo theo một lượt select mới cho mỗi lần.
    expect(select.mock.calls.length - before).toBeLessThanOrEqual(2);
  });

  it('lỗi mạng nổi lên qua isError', async () => {
    server.use(http.get(ROUTES.state, () => HttpResponse.json({ error: 'sập' }, { status: 500 })));
    const wrapper = createQueryWrapper();
    const { result } = renderHook(() => useElementCount(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('sập');
  });
});
