import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FEATURE_SYSTEM,
  TESTCASE_DESIGN_RULES,
  featureTask,
  modelTask,
} from '../prompt.js';
import { ensureLaunchBackground } from '../pipeline.js';

test('runtime prompt áp dụng policy coverage của skill', () => {
  for (const marker of [
    'P0 =',
    'P1 =',
    'P2 =',
    '3–8 scenario',
    'Scenario Outline',
    'I am logged in as',
    'I open feature',
    'I inspect section',
    'không thể hoàn tác',
  ]) {
    assert.match(TESTCASE_DESIGN_RULES, new RegExp(escapeRegExp(marker)));
  }
  assert.match(FEATURE_SYSTEM, /CONTROLLED VOCABULARY/);
  assert.match(FEATURE_SYSTEM, /Chỉ xuất nội dung của đúng một file \.feature/);
});

test('feature task dùng label logic và credential placeholder an toàn', () => {
  const task = featureTask('- login.submitButton — "Nút đăng nhập" (login)', {
    targetFeature: 'Đăng nhập TCInvest',
    accounts: [{ label: 'tcbs', username: 'safe-user-label' }],
  });

  assert.match(task, /Chức năng cần kiểm thử là "Đăng nhập TCInvest"/);
  assert.match(task, /login\.submitButton/);
  assert.match(task, /\{\{account\.tcbs\.username\}\}/);
  assert.match(task, /\{\{account\.tcbs\.password\}\}/);
});

test('skill và runtime giữ cùng các nguyên tắc cốt lõi', async () => {
  const skillPrompt = await readFile(
    new URL('../../../skills/testpilot-generate-testcases/references/generation-prompt.md', import.meta.url),
    'utf8',
  );
  for (const marker of ['P0', 'P1', 'P2', '3–8 scenario', 'Scenario Outline']) {
    assert.match(skillPrompt, new RegExp(escapeRegExp(marker)));
    assert.match(TESTCASE_DESIGN_RULES, new RegExp(escapeRegExp(marker)));
  }
});

test('generated feature luôn có Background mở ứng dụng', () => {
  const withoutBackground = [
    'Feature: Thêm mã',
    '',
    '  Scenario: Happy path',
    '    Given I am logged in as "tcbs"',
  ].join('\n');
  const guarded = ensureLaunchBackground(withoutBackground);
  assert.match(guarded, /Background:\n\s+Given I open the app/);

  const existing = [
    'Feature: Thêm mã',
    '',
    '  Background:',
    '    Given hệ thống sẵn sàng',
    '',
    '  Scenario: Happy path',
  ].join('\n');
  const enriched = ensureLaunchBackground(existing);
  assert.equal((enriched.match(/I open the app/g) ?? []).length, 1);
  assert.match(enriched, /Background:\n\s+Given I open the app\n\s+Given hệ thống sẵn sàng/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('the model task carries the names the registry already uses', () => {
  const known = {
    screens: [
      { id: 'addStockModal', title: 'Thêm mã cổ phiếu' },
      { id: 'priceBoard', title: 'Bảng giá cổ phiếu' },
    ],
    elements: [
      { id: 'addStockModal.suggestionList', label: 'Danh sách gợi ý', screen: 'addStockModal', candidates: {} },
      { id: 'priceBoard.addStockButton', label: 'Thêm mã', screen: 'priceBoard', candidates: {} },
    ],
  };
  const task = modelTask({}, known);

  // Telling the model to "use the registry label" while never showing it the
  // registry is what made every run coin a synonym.
  assert.match(task, /addStockModal — "Thêm mã cổ phiếu": "Danh sách gợi ý"/);
  assert.match(task, /priceBoard — "Bảng giá cổ phiếu": "Thêm mã"/);
  assert.match(task, /DÙNG LẠI ĐÚNG id và label/);
});

test('says nothing about prior names on a first run', () => {
  const task = modelTask({}, { screens: [], elements: [] });
  assert.ok(!task.includes('DÙNG LẠI'), 'registry rỗng thì không thêm nhiễu vào prompt');
  assert.equal(task, modelTask({}));
});
