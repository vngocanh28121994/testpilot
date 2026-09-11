/**
 * Healing bị chặn bởi chính bước kiểm chứng.
 *
 * Đo trên một lượt Device Farm thật: kịch bản chết ở `I click "THÊM MÃ"` với
 *
 *   [HEALING_REJECTED] Click "Thêm mã" không tạo đúng trạng thái:
 *   "I enter "ADS" into "Ô mã cổ phiếu"" chưa xuất hiện.
 *   Nguyên nhân cuối: Could not resolve "priceBoard.oMaCoPhieu" on web after 1 attempts.
 *
 * `priceBoard.oMaCoPhieu` chỉ có MỘT locator — `placeholder="Mã cổ phiếu"`, đã
 * thắng 30 lần liên tiếp. Giao diện đổi placeholder thành "TCB,VNM,FPT…", locator
 * hụt, và cả kịch bản đỏ. Discovery thừa sức tìm lại một ô nhập trên màn hình;
 * nó chỉ không được cấp thời gian:
 *
 *   ngân sách khi thử lại  2.000 ms
 *   watchBriefly           min(3.000, 2.000) = 2.000 ms   ← ăn sạch
 *   resolve + discovery    max(0, 0) = 0 ms
 *
 * Mà discovery chỉ BẮT ĐẦU sau 2.500 ms dò hụt.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/runtime/executor.ts', 'utf8');
const resolver = readFileSync('src/runtime/resolver.ts', 'utf8');

const numberOf = (text: string, name: string): number => {
  const found = new RegExp(`const ${name} = ([\\d_]+);`).exec(text)?.[1];
  return Number((found ?? '0').replaceAll('_', ''));
};

describe('ngân sách cho discovery ở cuối postcondition', () => {
  it('lượt resolve cuối có sàn, không nhận phần thừa bằng 0', () => {
    assert.match(source, /timeoutMs: Math\.max\(remaining, MIN_DISCOVERY_BUDGET_MS\)/);
  });

  /**
   * Sàn phải đủ cho discovery kịp khởi động VÀ chốt, nếu không thì nó chỉ đổi
   * một lỗi tức thì lấy một lỗi chậm hơn.
   */
  it('sàn đủ cho discovery khởi động và chốt', () => {
    const floor = numberOf(source, 'MIN_DISCOVERY_BUDGET_MS');
    const after = numberOf(resolver, 'DISCOVERY_AFTER_MS');
    const grace = numberOf(resolver, 'DISCOVERY_GRACE_MS');
    assert.ok(after > 0 && grace > 0, 'phải đọc được hai hằng số của resolver');
    assert.ok(floor >= after + grace, `sàn ${floor}ms phải >= ${after}+${grace}ms`);
  });

  /** Bước dò nhanh vẫn đứng trước: thứ một cú bấm tạo ra thường chỉ sống hai giây. */
  it('vẫn dò nhanh trước khi dò kỹ', () => {
    const order = source.indexOf('watchBriefly(expectation, timeoutMs)');
    const then = source.indexOf('MIN_DISCOVERY_BUDGET_MS)');
    assert.ok(order > 0 && then > order, 'watchBriefly phải chạy trước lượt resolve có sàn');
  });
});
