/**
 * "Trình duyệt không giải mã được hình từ máy … Decoder failure" hiện ra vì
 * MỘT mảnh hỏng (Wi-Fi khựng giữa khung khoá) — và bắt người dùng bấm Giữ máy
 * lại. Mảnh hỏng lẻ thì tự dựng lại; hỏng liên tục mới báo.
 */
import { describe, expect, it } from 'vitest';
import { DecodeRecovery, FAILURE_WINDOW_MS, MAX_FAILURES, decodeGiveUpMessage } from '@/lib/decodeRecovery';

describe('DecodeRecovery', () => {
  it('một lỗi lẻ thì dựng lại, không báo', () => {
    const r = new DecodeRecovery();
    expect(r.failed(0)).toBe(true);
  });

  it(`hỏng ${MAX_FAILURES} lần liền mà không vẽ được khung nào thì báo`, () => {
    const r = new DecodeRecovery();
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) expect(r.failed(i * 1000)).toBe(true);
    expect(r.failed(MAX_FAILURES * 1000)).toBe(false);
  });

  it('vẽ được một khung giữa các lần hỏng thì đếm lại từ đầu', () => {
    const r = new DecodeRecovery();
    r.failed(0);
    r.failed(1000);
    r.drew();
    expect(r.failed(2000)).toBe(true);
  });

  it('lỗi cũ quá khung thời gian thì không tính', () => {
    const r = new DecodeRecovery();
    r.failed(0);
    r.failed(1);
    expect(r.failed(FAILURE_WINDOW_MS + 10)).toBe(true);
  });

  it('câu báo nói việc cần làm, và nhắc HTTPS khi trang không an toàn', () => {
    expect(decodeGiveUpMessage('Decoder failure', false)).toMatch(/HTTPS/);
    expect(decodeGiveUpMessage('Decoder failure', true)).not.toMatch(/HTTPS/);
    expect(decodeGiveUpMessage('Decoder failure', true)).toMatch(/Nhả máy rồi Giữ máy lại/);
  });
});
