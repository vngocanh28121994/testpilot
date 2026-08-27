import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Registry } from '../../core/registry.js';
import { prepareExecutableDraft } from '../draft.js';

describe('executable draft compiler', () => {
  it('normalizes, registers and binds a valid business draft before persistence', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-draft-registry.json');
    const prepared = await prepareExecutableDraft([
      'Feature: Danh mục',
      '  Scenario: Hiển thị danh mục',
      '    Then Danh sách mã hiển thị',
    ].join('\n'), registry, {
      model: 'test', uri: 'draft.feature', aiAvailable: false,
    });

    assert.equal(prepared.repaired, false);
    assert.match(prepared.content, /Then "Danh sách mã" is visible/);
    assert.equal(prepared.spec.scenarios[0]?.steps[0]?.intent.kind, 'assertVisible');
    assert.equal(prepared.pendingElements[0]?.label, 'Danh sách mã');
  });

  it('uses AI only to repair technical wording and recompiles the result', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-repair-registry.json');
    let calls = 0;
    const prepared = await prepareExecutableDraft([
      'Feature: Danh mục',
      '  Scenario: Mở danh mục',
      '    When người dùng làm thao tác hoàn toàn mới',
    ].join('\n'), registry, {
      model: 'test', uri: 'repair.feature', aiAvailable: true,
      repair: async () => {
        calls += 1;
        return [
          'Feature: Danh mục',
          '  Scenario: Mở danh mục',
          '    When I click "Danh mục"',
        ].join('\n');
      },
    });

    assert.equal(calls, 1);
    assert.equal(prepared.repaired, true);
    assert.equal(prepared.spec.scenarios[0]?.steps[0]?.intent.kind, 'tap');
  });

  it('does not present an unbound draft as reviewable when repair is unavailable', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-invalid-draft-registry.json');
    await assert.rejects(
      prepareExecutableDraft([
        'Feature: Danh mục',
        '  Scenario: Không hợp lệ',
        '    When thao tác không xác định',
      ].join('\n'), registry, {
        model: 'test', uri: 'invalid.feature', aiAvailable: false,
      }),
      /Bản lỗi không được ghi vào danh sách duyệt/,
    );
  });

  it('never sends a locally entered password value to the repair model', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-secret-draft-registry.json');
    let payload = '';
    const prepared = await prepareExecutableDraft([
      'Feature: Login',
      '  Scenario: Secure repair',
      '    When I enter "LOCAL_ONLY_VALUE" into "Ô mật khẩu"',
      '    And thao tác mới',
    ].join('\n'), registry, {
      model: 'test', uri: 'secret.feature', aiAvailable: true,
      repair: async (request) => {
        payload = request.user;
        return [
          'Feature: Login',
          '  Scenario: Secure repair',
          '    When I enter "{{TESTPILOT_LOCAL_SECRET_1}}" into "Ô mật khẩu"',
          '    And I click "Tiếp tục"',
        ].join('\n');
      },
    });

    assert.doesNotMatch(payload, /LOCAL_ONLY_VALUE/);
    assert.match(payload, /TESTPILOT_LOCAL_SECRET_1/);
    assert.match(prepared.content, /LOCAL_ONLY_VALUE/);
  });
});
