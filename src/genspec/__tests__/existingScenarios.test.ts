/**
 * Showing the model the tests that already exist.
 *
 * Two business features on one screen are generated from two documents, and the
 * model has never been shown either one's scenarios. So the flow they share is
 * written twice: run twice, one fault reported as two, and the copies drift
 * apart the first time somebody edits one. The registry solved exactly this for
 * element names by putting them in the prompt; this does the same for tests.
 *
 * The subtle half is the exclusion. Regeneration must stay free to rewrite the
 * feature it is regenerating — if its own scenarios came back as "already
 * covered elsewhere", the model would decline to write them and the file would
 * come back empty.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadExistingScenarios } from '../existingScenarios.js';
import { existingScenarioBlock } from '../prompt.js';

async function featuresDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'feat-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

const transfer = `Feature: Chuyển tiền nội bộ

  Scenario: Chuyển tiền thành công
    When I click "Nút CHUYỂN"

  Scenario: Chuyển tiền vượt hạn mức
    When I click "Nút CHUYỂN"
`;

const board = `Feature: Bảng giá cổ phiếu

  Scenario: Thêm mã cổ phiếu mới
    When I click "Thêm mã"
`;

describe('reading what the project already tests', () => {
  it('lists every scenario with the feature that owns it', async () => {
    const dir = await featuresDir({ 'a.feature': transfer, 'b.feature': board });
    const found = await loadExistingScenarios(dir, '');
    assert.equal(found.length, 3);
    assert.deepEqual(
      found.map((s) => `${s.feature}::${s.name}`).sort(),
      [
        'Bảng giá cổ phiếu::Thêm mã cổ phiếu mới',
        'Chuyển tiền nội bộ::Chuyển tiền thành công',
        'Chuyển tiền nội bộ::Chuyển tiền vượt hạn mức',
      ],
    );
  });

  it('excludes the feature about to be rewritten', async () => {
    // Without this, regenerating "Chuyển tiền nội bộ" would be told its own
    // scenarios belong to somebody else, and it would write none of them.
    const dir = await featuresDir({ 'chuyen-tien.feature': transfer, 'b.feature': board });
    const found = await loadExistingScenarios(dir, 'chuyen-tien');
    assert.deepEqual(found.map((s) => s.name), ['Thêm mã cổ phiếu mới']);
  });

  it('survives a directory that does not exist yet', async () => {
    assert.deepEqual(await loadExistingScenarios('/khong/co/thu/muc/nay', ''), []);
  });
});

describe('what the model is told', () => {
  it('groups the scenarios under their feature', () => {
    const block = existingScenarioBlock([
      { feature: 'Chuyển tiền nội bộ', name: 'Chuyển tiền thành công' },
      { feature: 'Chuyển tiền nội bộ', name: 'Chuyển tiền vượt hạn mức' },
      { feature: 'Bảng giá cổ phiếu', name: 'Thêm mã cổ phiếu mới' },
    ]);
    assert.match(block, /- Chuyển tiền nội bộ:/);
    assert.match(block, /• Chuyển tiền vượt hạn mức/);
    assert.match(block, /- Bảng giá cổ phiếu:/);
  });

  it('says why, not just what', () => {
    // A bare list invites the model to treat it as context. The reason is what
    // makes it a constraint.
    const block = existingScenarioBlock([{ feature: 'F', name: 'S' }]);
    assert.match(block, /ĐỪNG viết lại/);
  });

  it('adds nothing to the prompt when the project has no other tests', () => {
    assert.equal(existingScenarioBlock([]), '');
    assert.equal(existingScenarioBlock(undefined), '');
  });
});
