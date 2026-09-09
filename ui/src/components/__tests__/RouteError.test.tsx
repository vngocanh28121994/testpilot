import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/utils';
import { RouteError } from '@/components/RouteError';
import { reloadPage } from '@/lib/reload';

vi.mock('@/lib/reload', () => ({ reloadPage: vi.fn() }));
const reload = vi.mocked(reloadPage);

/**
 * Lỗi route phải để lại đủ thứ để sửa được.
 *
 * Bản mặc định của TanStack chỉ in error.message. Trên bundle minify thì đó là
 * "l is not a function" — không stack, không route, không component. Một buổi
 * đã mất vì đúng dòng đó.
 */
const chunkError = () =>
  Object.assign(new Error('Failed to fetch dynamically imported module: /assets/scenarios-D6OXLo2H.js'), {
    name: 'TypeError',
  });

beforeEach(() => {
  sessionStorage.clear();
  reload.mockClear();
});

const render = (error: Error) =>
  renderWithRouter(<RouteError error={error} />, { path: '/scenarios' });

describe('RouteError', () => {
  it('hiện stack, không chỉ một dòng message', async () => {
    const err = new Error('l is not a function');
    err.stack = 'TypeError: l is not a function\n    at Xyz (index-abc.js:1:2)';
    await render(err);
    // Câu lỗi xuất hiện hai chỗ là đúng: tiêu đề, và trong stack bên dưới.
    expect((await screen.findAllByText(/l is not a function/)).length).toBeGreaterThan(1);
    expect(screen.getByText(/at Xyz \(index-abc\.js/)).toBeInTheDocument();
  });

  it('nói rõ đang ở route nào', async () => {
    await render(new Error('bùm'));
    expect(await screen.findByText('/scenarios')).toBeInTheDocument();
  });

  /**
   * Chunk của bản build cũ đã bị xoá — chuyện xảy ra mỗi lần deploy khi có
   * người đang mở app. Tải lại là cách sửa duy nhất.
   */
  it('chunk cũ biến mất thì tự tải lại', async () => {
    await render(chunkError());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('không tải lại vòng vo khi vừa tải lại xong', async () => {
    sessionStorage.setItem('testpilot:chunk-reload', String(Date.now()));
    await render(chunkError());
    expect(reload).not.toHaveBeenCalled();
    expect(await screen.findByText(/Bản build đã đổi/)).toBeInTheDocument();
  });

  /** Sự cố lần sau, cách xa lần trước, vẫn đáng được một lần tải lại. */
  it('sự cố mới sau đó vẫn được tự sửa', async () => {
    sessionStorage.setItem('testpilot:chunk-reload', String(Date.now() - 60_000));
    await render(chunkError());
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('lỗi thường thì không tự tải lại', async () => {
    await render(new Error('l is not a function'));
    expect(reload).not.toHaveBeenCalled();
  });
});
