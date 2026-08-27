import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ActionRegistry } from '../ActionRegistry.js';

test('approved macro expands parameters and always appends its postcondition', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-actions-'));
  const file = path.join(dir, 'actions.json');
  const registry = await ActionRegistry.load(file);
  const proposal = registry.propose({
    label: 'Xoá mã khỏi danh mục',
    kind: 'macro',
    phraseTemplate: 'I remove "{{stockCode}}" from watchlist',
    parameters: [{ name: 'stockCode', example: 'ADS' }],
    expansion: [
      'I tap "Icon ... tại dòng {{stockCode}}"',
      'I tap "Xoá khỏi danh mục"',
    ],
    postcondition: '"{{stockCode}}" is not visible',
    sourceExample: 'I remove "ADS" from watchlist',
  });
  registry.review(proposal.id, 'approve');
  await registry.save();

  const reloaded = await ActionRegistry.load(file);
  assert.deepEqual(reloaded.expand('I remove "HPG" from watchlist')?.steps, [
    'I tap "Icon ... tại dòng HPG"',
    'I tap "Xoá khỏi danh mục"',
    '"HPG" is not visible',
  ]);
  assert.match(await readFile(file, 'utf8'), /"status": "approved"/);
});

test('primitive proposals cannot be approved without a driver adapter', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-actions-'));
  const registry = await ActionRegistry.load(path.join(dir, 'actions.json'));
  const proposal = registry.propose({
    label: 'Vẽ chữ ký',
    kind: 'primitive',
    phraseTemplate: 'I draw signature',
    parameters: [],
    expansion: [],
    postcondition: '"Chữ ký" is visible',
    sourceExample: 'I draw signature',
  });
  assert.throws(() => registry.review(proposal.id, 'approve'), /capability mới/);
});

test('a later model proposal cannot overwrite a human-approved definition', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-actions-'));
  const registry = await ActionRegistry.load(path.join(dir, 'actions.json'));
  const original = registry.propose({
    label: 'Mở menu dòng',
    kind: 'alias',
    phraseTemplate: 'I open menu for "{{row}}"',
    parameters: [{ name: 'row', example: 'ADS' }],
    expansion: ['I tap "Icon ... tại dòng {{row}}"'],
    postcondition: '"Xoá khỏi danh mục" is visible',
    sourceExample: 'I open menu for "ADS"',
  });
  registry.review(original.id, 'approve');
  const repeated = registry.propose({
    label: 'Nội dung do model thay đổi',
    kind: 'macro',
    phraseTemplate: original.phraseTemplate,
    parameters: original.parameters,
    expansion: ['I tap "Sai element"'],
    postcondition: '"Sai element" is visible',
    sourceExample: original.sourceExample,
  });
  assert.equal(repeated.label, 'Mở menu dòng');
  assert.deepEqual(repeated.expansion, ['I tap "Icon ... tại dòng {{row}}"']);
});
