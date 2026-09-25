import { describe, expect, it } from 'vitest';
import { noVideoDecoderMessage } from '../useDeviceControl';

/**
 * Máy con vào máy chủ qua http://<IP> đều không xem được màn Android, kể cả
 * Chrome — câu cũ bảo "Chrome hoặc Edge thì xem được", sai.
 */
describe('noVideoDecoderMessage', () => {
  it('trang HTTP thường: nói đúng nguyên nhân và cách tạm, kèm đúng địa chỉ', () => {
    const msg = noVideoDecoderMessage(false, 'http://10.33.86.240:4300');
    expect(msg).toMatch(/HTTP thường/);
    expect(msg).toMatch(/chrome:\/\/flags\/#unsafely-treat-insecure-origin-as-secure/);
    expect(msg).toContain('http://10.33.86.240:4300');
    expect(msg).not.toMatch(/Chrome hoặc Edge thì xem được/);
  });

  it('trang an toàn mà vẫn thiếu: trình duyệt cũ', () => {
    expect(noVideoDecoderMessage(true, 'https://x')).toMatch(/Chrome, Edge hoặc Safari bản mới/);
  });
});
