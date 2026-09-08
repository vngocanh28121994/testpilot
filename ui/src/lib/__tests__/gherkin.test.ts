import { describe, expect, it } from 'vitest';
import {
  appendScenario,
  extractScenario,
  findScenarioBounds,
  replaceScenario,
  tagsOf,
  withTags,
} from '../gherkin';

const FILE = `Feature: Chuyển tiền nội bộ

  @smoke @transfer
  Scenario: Chuyển tiền thành công
    Given I open the app
    When I tap "transfer.submitButton"

  @regression
  Scenario: Số dư không đủ
    Given I open the app
    Then I see "Số dư không đủ"
`;

describe('cắt ghép Gherkin', () => {
  it('lấy đúng khối của một kịch bản, kèm tag đứng trên nó', () => {
    expect(extractScenario(FILE, 'Chuyển tiền thành công')).toBe(
      ['@smoke @transfer', '  Scenario: Chuyển tiền thành công', '    Given I open the app', '    When I tap "transfer.submitButton"'].join('\n'),
    );
  });

  it('không nuốt sang kịch bản kế tiếp', () => {
    expect(extractScenario(FILE, 'Chuyển tiền thành công')).not.toContain('Số dư không đủ');
  });

  it('trả rỗng khi không có tên đó', () => {
    expect(extractScenario(FILE, 'Không tồn tại')).toBe('');
  });

  /**
   * Đây là lý do tồn tại của cả file này: sửa một kịch bản không được đụng tới
   * kịch bản bên cạnh. Ô textarea chứa cả file thì mọi thao tác đều có rủi ro đó.
   */
  it('thay một kịch bản mà giữ nguyên kịch bản còn lại', () => {
    const next = replaceScenario(
      FILE,
      'Chuyển tiền thành công',
      '@smoke\n  Scenario: Chuyển tiền thành công\n    Given I open the app',
    );
    expect(next).toContain('Scenario: Số dư không đủ');
    expect(next).toContain('Then I see "Số dư không đủ"');
    expect(next).not.toContain('transfer.submitButton');
  });

  it('chừa dòng trống nên kịch bản sau không dính vào bước cuối', () => {
    const next = replaceScenario(FILE, 'Chuyển tiền thành công', '  Scenario: X\n    Given I open the app');
    expect(next).toContain('Given I open the app\n\n  @regression');
  });

  it('trả nguyên nội dung khi tên kịch bản không khớp', () => {
    expect(replaceScenario(FILE, 'Không có', 'gì đó')).toBe(FILE);
  });

  it('thêm kịch bản vào cuối file, cách một dòng trống', () => {
    expect(appendScenario('Feature: A', '  Scenario: B')).toBe('Feature: A\n\n  Scenario: B\n');
  });

  it('thêm được vào file rỗng mà không chừa dòng trống ở đầu', () => {
    expect(appendScenario('', '  Scenario: B')).toBe('  Scenario: B\n');
  });

  it('đọc tag ở đầu khối', () => {
    expect(tagsOf('@smoke @transfer\n  Scenario: X')).toEqual(['@smoke', '@transfer']);
  });

  it('không nhặt tag nằm dưới phần thân', () => {
    expect(tagsOf('  Scenario: X\n    Given a\n@muộn')).toEqual([]);
  });

  it('viết lại dòng tag mà giữ nguyên phần thân', () => {
    expect(withTags('@cũ\n  Scenario: X\n    Given a', ['@mới'])).toBe('@mới\n  Scenario: X\n    Given a');
  });

  it('xoá hẳn dòng tag khi không còn tag nào', () => {
    expect(withTags('@cũ\n  Scenario: X', [])).toBe('  Scenario: X');
  });

  it('tìm được ranh giới kể cả Scenario Outline', () => {
    const lines = ['  Scenario Outline: X', '    Given a'];
    expect(findScenarioBounds(lines, 'X')).toEqual({ start: 0, end: 2 });
  });
});
