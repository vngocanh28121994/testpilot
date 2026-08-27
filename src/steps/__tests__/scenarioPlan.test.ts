import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyScenarioPlan,
  deterministicScenarioPlan,
  planningInput,
  validateScenarioPlan,
} from '../scenarioPlan.js';

const feature = [
  'Feature: Fundmart',
  '',
  '  @fund',
  '  Scenario: Kiểm tra quỹ quan tâm',
  '    Given người dùng đã đăng nhập bằng tài khoản "tcbs"',
  '    When người dùng mở chức năng "Fundmart"',
  '    And người dùng kiểm tra Các quỹ có thể bạn quan tâm',
  '    And người dùng chọn mốc 1M trong Các quỹ có thể bạn quan tâm',
  '    Then "Biểu đồ hiệu suất" hiển thị',
].join('\n');

describe('semantic scenario plan', () => {
  it('redacts credential-bearing wording before external planning', () => {
    const input = planningInput([
      'Scenario: Đăng nhập',
      '  When I enter "{{account.tcbs.password}}" into "Ô mật khẩu"',
    ].join('\n'));

    assert.equal(input.steps[0]?.line, 2);
    assert.equal(input.steps[0]?.text, '[Bước thông tin đăng nhập được giữ cục bộ]');
    assert.doesNotMatch(JSON.stringify(input), /account\.tcbs\.password/);
  });

  it('builds a useful deterministic fallback when no AI key is available', () => {
    const plan = deterministicScenarioPlan([
      'Scenario: Hiệu quả đầu tư',
      '  Given I am logged in as "tcbs"',
      '  When I open feature "Hiệu quả đầu tư" from search',
      '  And I inspect section "Thống kê chung"',
    ].join('\n'));

    assert.equal(plan.source, 'deterministic');
    assert.deepEqual(plan.reusableFlows, ['Đăng nhập', 'Mở chức năng từ tìm kiếm']);
    assert.equal(plan.steps.at(-1)?.kind, 'focusRegion');
    assert.equal(plan.steps.at(-1)?.scope, 'Thống kê chung');
  });

  it('compiles an inspected business section without flattening it to an assertion', () => {
    const plan = validateScenarioPlan({
      goal: 'Kiểm tra quỹ quan tâm',
      preconditions: ['Người dùng đã nạp tiền'],
      reusableFlows: ['Đặt lệnh mua'],
      steps: [{
        line: 7,
        kind: 'focusRegion',
        target: 'Các quỹ có thể bạn quan tâm',
        scope: 'Các quỹ có thể bạn quan tâm',
        confidence: 0.96,
        reason: 'Người dùng đang giới hạn vùng nghiệp vụ cho bước sau',
      }],
    }, feature);

    assert.ok(plan);
    assert.deepEqual(plan.preconditions, ['Đã đăng nhập']);
    assert.deepEqual(plan.reusableFlows, ['Đăng nhập', 'Mở chức năng từ tìm kiếm']);
    const applied = applyScenarioPlan(feature, plan);
    assert.match(applied.content, /And I inspect section "Các quỹ có thể bạn quan tâm"/);
    assert.doesNotMatch(applied.content, /"Các quỹ có thể bạn quan tâm" is visible/);
  });

  it('splits a combined scope-and-action sentence into two controlled intents', () => {
    const plan = validateScenarioPlan({
      steps: [{
        line: 8,
        kind: 'action',
        target: '1M',
        scope: 'Các quỹ có thể bạn quan tâm',
        action: 'click',
        confidence: 0.92,
        reason: 'Câu chứa cả vùng và thao tác',
      }],
    }, feature);

    assert.ok(plan);
    const applied = applyScenarioPlan(feature, plan);
    assert.match(
      applied.content,
      /And I inspect section "Các quỹ có thể bạn quan tâm"\n    And I click "1M"/,
    );
  });

  it('does not compile low-confidence meaning automatically', () => {
    const plan = validateScenarioPlan({
      steps: [{
        line: 7,
        kind: 'focusRegion',
        target: 'Các quỹ có thể bạn quan tâm',
        confidence: 0.55,
        reason: 'Câu còn mơ hồ',
      }],
    }, feature);

    assert.ok(plan);
    const applied = applyScenarioPlan(feature, plan).content;
    assert.match(applied, /And người dùng kiểm tra Các quỹ có thể bạn quan tâm/);
    assert.doesNotMatch(applied, /And I inspect section "Các quỹ có thể bạn quan tâm"\n\s+And I inspect section/);
  });

  it('rejects invented targets and selector/code payloads from model output', () => {
    const invented = validateScenarioPlan({
      steps: [{ line: 7, kind: 'action', target: 'Nút không tồn tại', confidence: 1 }],
    }, feature);
    const selector = validateScenarioPlan({
      steps: [{ line: 7, kind: 'action', target: 'xpath=//button', confidence: 1 }],
    }, feature);

    assert.equal(invented, undefined);
    assert.equal(selector, undefined);
  });
});
