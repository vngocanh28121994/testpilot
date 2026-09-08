import { describe, expect, it } from 'vitest';
import { tokenizeLine, type Token } from '../gherkinTokens';

const kinds = (line: string) => tokenizeLine(line).map((t) => `${t.kind}:${t.text}`);
const join = (tokens: Token[]) => tokens.map((t) => t.text).join('');

describe('tô màu Gherkin', () => {
  /**
   * Điều kiện sống còn: lớp tô màu nằm DƯỚI textarea, khớp từng ký tự. Nuốt
   * mất một khoảng trắng là chữ tô màu lệch khỏi chữ người dùng đang gõ, và
   * càng gõ càng lệch.
   */
  it('ghép lại luôn ra đúng dòng ban đầu', () => {
    for (const line of [
      '    Given I open the app',
      '  @smoke   @web',
      '  Scenario: Chuyển tiền',
      '    Then "Số dư" shows "1.000" exactly "2" times',
      '      | tên | giá |',
      '# ghi chú',
      '',
      '   ',
      'không phải Gherkin',
    ]) {
      expect(join(tokenizeLine(line))).toBe(line);
    }
  });

  it('nhận từ khoá mở đầu khối', () => {
    expect(kinds('Feature: Đăng nhập')).toContain('heading:Feature:');
    expect(kinds('  Scenario Outline: X')).toContain('heading:Scenario Outline:');
    expect(kinds('  Background:')).toContain('heading:Background:');
    expect(kinds('    Examples:')).toContain('heading:Examples:');
  });

  it('nhận từ khoá mở đầu bước', () => {
    for (const word of ['Given', 'When', 'Then', 'And', 'But', '*']) {
      expect(kinds(`    ${word} gì đó`)).toContain(`step:${word}`);
    }
  });

  /**
   * "Android" mở đầu bằng "And" — bắt theo tiền tố chuỗi thì nửa chữ đầu của
   * một câu bình thường bị tô như từ khoá.
   */
  it('không nhầm chữ chỉ tình cờ bắt đầu giống từ khoá', () => {
    expect(kinds('    Android là hệ điều hành')).not.toContain('step:And');
    expect(kinds('    Whenever tôi mở app')).not.toContain('step:When');
  });

  it('tô chuỗi trong nháy kép, tham số trong ngoặc nhọn, và số', () => {
    const line = '    Then I enter "VIC" into <ô> for 12 times';
    expect(kinds(line)).toContain('string:"VIC"');
    expect(kinds(line)).toContain('param:<ô>');
    expect(kinds(line)).toContain('number:12');
  });

  it('số nằm trong nháy kép vẫn là chuỗi, không tách làm đôi', () => {
    expect(kinds('Then it shows "1000"')).toContain('string:"1000"');
  });

  it('cả dòng chú thích là chú thích', () => {
    expect(kinds('  # Given đây chỉ là ghi chú')).toEqual(['comment:  # Given đây chỉ là ghi chú']);
  });

  it('mỗi tag là một mảnh riêng', () => {
    expect(kinds('  @p0 @smoke')).toEqual(['text:  ', 'tag:@p0', 'text: ', 'tag:@smoke']);
  });

  it('gạch đứng của bảng Examples được tách ra', () => {
    expect(kinds('| a | b |').filter((k) => k.startsWith('table:'))).toHaveLength(3);
  });

  it('dòng rỗng không sinh mảnh nào', () => {
    expect(tokenizeLine('')).toEqual([]);
  });
});
