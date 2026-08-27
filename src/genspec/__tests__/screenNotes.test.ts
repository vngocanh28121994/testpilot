/**
 * Knowledge that survives regeneration.
 *
 * Everything the generator is told comes from documents, and documents do not
 * describe behaviour nobody wrote down — that the ⊕ button must be clicked a
 * second time to commit a symbol took a day of debugging to establish. Fixing
 * the scenario by hand does not keep it: the next generation overwrites the
 * file and produces the same wrong steps again, which is exactly what happened.
 *
 * So the fact belongs in the registry, and the registry has to reach the
 * prompt. These tests hold that path open.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { featureTask, knownModelBlock, screenNotesBlock } from '../prompt.js';
import type { ElementDef, ScreenDef } from '../../core/types.js';

const screen = (over: Partial<ScreenDef> = {}): ScreenDef => ({
  id: 'addStockModal', title: 'Thêm mã cổ phiếu', ...over,
});
const element = (over: Partial<ElementDef> = {}): ElementDef => ({
  id: 'p.x', label: 'Danh sách gợi ý mã cổ phiếu', screen: 'addStockModal', candidates: {}, ...over,
});

describe('behavioural notes reach the generator', () => {
  it('carries every note verbatim', () => {
    const block = screenNotesBlock({
      screens: [screen({ notes: ['Nút "Thêm mã" được dùng HAI lần trong một luồng.'] })],
    });
    assert.match(block, /Nút "Thêm mã" được dùng HAI lần/);
  });

  it('says the notes are verified behaviour, not documentation', () => {
    const block = screenNotesBlock({ screens: [screen({ notes: ['bất kỳ'] })] });
    // The model has to know these outrank the source document, which says
    // nothing about them and would otherwise look like the fuller authority.
    assert.match(block, /Tài liệu KHÔNG nêu/);
  });

  it('stays empty when no screen has notes, so the prompt does not grow', () => {
    assert.equal(screenNotesBlock({ screens: [screen()] }), '');
    assert.equal(screenNotesBlock(undefined), '');
  });

  it('reaches the feature prompt, not just the block builder', () => {
    const task = featureTask('- p.x — "Danh sách gợi ý" (addStockModal)', {}, {
      screens: [screen({ notes: ['phải bấm "Thêm mã" lần thứ hai'] })],
    });
    assert.match(task, /phải bấm "Thêm mã" lần thứ hai/);
  });
});

describe('known-name block', () => {
  it('shows aliases beside the label so a third name is not invented', () => {
    const block = knownModelBlock({
      screens: [screen()],
      elements: [element({ aliases: ['Danh sách gợi ý'] })],
    });
    assert.match(block, /"Danh sách gợi ý mã cổ phiếu" = "Danh sách gợi ý"/);
  });

  it('still lists an element that has no aliases', () => {
    const block = knownModelBlock({ screens: [screen()], elements: [element()] });
    assert.match(block, /"Danh sách gợi ý mã cổ phiếu"/);
  });
});
