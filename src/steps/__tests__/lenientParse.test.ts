/**
 * Workflow sinh "Đăng nhập TCInvest" với tám kịch bản, bảy bước trong đó chưa
 * hiểu được ("I am on the login screen"). Màn duyệt hiện "0 kịch bản": một bước
 * lạ làm `parseFeature` ném lỗi cho CẢ file, và danh sách trả `scenarios: []`.
 * Người duyệt không có chỗ nào để mở ra sửa chính những bước đó.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Registry } from '../../core/registry.js';
import { parseFeature } from '../binding.js';

const FEATURE = `Feature: Đăng nhập

  Scenario: Có bước lạ
    Given I am on the login screen
    When I go back

  Scenario: Không có bước lạ
    When I go back
`;

describe('parseFeature — chế độ khoan dung cho màn duyệt', () => {
  it('chế độ chặt (lượt chạy) vẫn ném lỗi như cũ', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-lenient-registry.json');
    assert.throws(() => parseFeature('x.feature', FEATURE, registry), /no step rule matches/);
  });

  it('khoan dung: vẫn liệt kê MỌI kịch bản, lỗi gắn đúng kịch bản và đúng dòng', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-lenient-registry.json');
    const spec = parseFeature('x.feature', FEATURE, registry, { lenient: true });
    assert.deepEqual(spec.scenarios.map((s) => s.name), ['Có bước lạ', 'Không có bước lạ']);
    assert.deepEqual(spec.scenarios[0]!.bindErrors, ['Dòng 4: chưa hiểu thao tác “I am on the login screen”.']);
    assert.equal(spec.scenarios[0]!.steps.length, 1, 'bước hiểu được vẫn được đọc');
    assert.equal(spec.scenarios[1]!.bindErrors, undefined);
  });
});
