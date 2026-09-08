import { describe, expect, it } from 'vitest';
import { describeFailure } from '@/lib/failure';

/** Nguyên văn lấy từ registry/history.json, không phải câu tự nghĩ ra. */
const GEMINI_503 = `Gemini Vision 503: {
  "error": {
    "code": 503,
    "message": "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
    "status": "UNAVAILABLE"
  }
}`;
const TEST_FAILED = 'Automation có testcase fail sau khi áp dụng locator healing/retry theo policy.';

describe('describeFailure', () => {
  it('gọi tên nhà cung cấp thay vì hiện mã 503', () => {
    const f = describeFailure(GEMINI_503);
    expect(f.kind).toBe('provider_busy');
    expect(f.title).toBe('Gemini đang quá tải');
    expect(f.title).not.toMatch(/503|\{/);
  });

  /**
   * Điểm quan trọng nhất của cả tệp này: người dùng dừng lại ở lỗi đỏ để tự
   * kiểm tra tài liệu và cấu hình của mình, trong khi chẳng có gì để sửa.
   */
  it('nói rõ đây không phải lỗi của người dùng', () => {
    expect(describeFailure(GEMINI_503).detail).toMatch(/không phải lỗi/i);
  });

  it('bảo chờ rồi chạy lại, và cho phép chạy lại', () => {
    const f = describeFailure(GEMINI_503);
    expect(f.retryable).toBe(true);
    expect(f.hint).toMatch(/đợi/i);
  });

  it('vẫn giữ nguyên văn cho người đi đào lỗi', () => {
    expect(describeFailure(GEMINI_503).raw).toBe(GEMINI_503);
  });

  /** Cùng là HTTP 429; chờ thì qua một cái, cái kia chờ mấy cũng vô ích. */
  it('phân biệt hết hạn mức với quá tải', () => {
    const quota = describeFailure('DeepSeek 429: {"error":{"message":"You exceeded your current quota"}}');
    expect(quota.kind).toBe('provider_quota');
    expect(quota.retryable).toBe(false);
  });

  it('khoá API sai thì không mời chạy lại', () => {
    const f = describeFailure('Gemini Vision 403: {"error":{"message":"API key not valid"}}');
    expect(f.kind).toBe('provider_auth');
    expect(f.retryable).toBe(false);
    expect(f.hint).toMatch(/khoá/i);
  });

  /** Chạy hết mà có case đỏ là KẾT QUẢ, không phải hỏng hóc. */
  it('không gọi testcase fail là lỗi hệ thống', () => {
    const f = describeFailure(TEST_FAILED);
    expect(f.kind).toBe('test_failed');
    expect(f.detail).toMatch(/không phải lỗi hệ thống/i);
    expect(f.retryable).toBe(false);
  });

  /** Biến thể thứ hai của cùng chuyện đó (server.ts:2229) — từng rơi vào "lỗi lạ". */
  it('assertion fail cũng là kết quả kiểm thử', () => {
    const f = describeFailure('Automation có assertion fail. Kết quả nghiệp vụ được giữ nguyên và không retry.');
    expect(f.kind).toBe('test_failed');
    expect(f.detail).toContain('Kết quả nghiệp vụ được giữ nguyên');
  });

  it('lấy câu giải thích của chính nhà cung cấp khi có', () => {
    expect(describeFailure('DeepSeek 402: {"error":{"message":"Insufficient Balance"}}').detail)
      .toBe('Insufficient Balance');
  });

  /** Chỗ ném cắt detail ở 300 ký tự, nên JSON tới tay có thể cụt. */
  it('vẫn đọc được message khi JSON bị cắt cụt', () => {
    const f = describeFailure('Gemini Vision 429: {"error":{"message":"Resource has been exhausted","code');
    expect(f.kind).toBe('provider_quota');
  });

  it('timeout và lỗi mạng là hai chuyện khác nhau', () => {
    expect(describeFailure('The operation was aborted due to timeout').kind).toBe('timeout');
    expect(describeFailure('fetch failed: ECONNREFUSED').kind).toBe('network');
  });

  /** Không nhận ra thì đưa nguyên câu, không bịa lời trấn an. */
  it('lỗi lạ thì giữ nguyên câu lỗi', () => {
    const f = describeFailure('Cannot read properties of undefined (reading foo)');
    expect(f.kind).toBe('unknown');
    expect(f.detail).toContain('reading foo');
  });

  it('không có lỗi kèm theo vẫn ra một câu tử tế', () => {
    expect(describeFailure(undefined).detail).not.toMatch(/undefined/);
  });
});
