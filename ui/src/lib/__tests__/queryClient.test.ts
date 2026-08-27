import { describe, expect, it } from 'vitest';
import { queryClient } from '@/lib/queryClient';
import { ApiRequestError } from '@/api/client';

/**
 * Policy retry, xem UI-MIGRATION-PLAN §Phase 2.5.
 *
 * Nhóm route chậm KHÔNG được thử lại: một lệnh gọi AWS Device Farm hỏng mất
 * ~30 giây để hỏng, thử thêm hai lần là bắt người dùng chờ 90 giây để nhận
 * đúng một thông báo lỗi. Với những route này, hỏng nhanh là tính năng.
 */
function shouldRetry(path: string, failureCount: number): boolean {
  const retry = queryClient.getDefaultOptions().queries?.retry;
  if (typeof retry !== 'function') throw new Error('retry phải là hàm');
  return Boolean(retry(failureCount, new ApiRequestError('hỏng', path, 500)));
}

describe('policy retry của queryClient', () => {
  it.each(['/api/aws', '/api/aws/login', '/api/prereq/adb', '/api/farm/pools'])(
    'không thử lại route chậm: %s',
    (path) => {
      expect(shouldRetry(path, 0)).toBe(false);
    },
  );

  it('thử lại route thường tối đa 2 lần', () => {
    expect(shouldRetry('/api/state', 0)).toBe(true);
    expect(shouldRetry('/api/state', 1)).toBe(true);
    expect(shouldRetry('/api/state', 2)).toBe(false);
  });

  it('lỗi không phải ApiRequestError (không có path) vẫn theo luật chung', () => {
    const retry = queryClient.getDefaultOptions().queries?.retry;
    if (typeof retry !== 'function') throw new Error('retry phải là hàm');
    expect(Boolean(retry(0, new Error('mạng hỏng')))).toBe(true);
    expect(Boolean(retry(5, new Error('mạng hỏng')))).toBe(false);
  });
});
