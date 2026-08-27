/**
 * A model that invents a strategy name must not cost the whole generation.
 *
 * The JSON schema carries the seven valid names, but the response is parsed out
 * of the model's text rather than enforced by the API, so the enum is guidance.
 * One run produced `"text"` — a perfectly natural word for "match the visible
 * string" — and the workflow died at its first stage with no registry, no
 * scenarios and nothing to review, over one locator on one element.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normaliseStrategy, toCandidate } from '../generate.js';

describe('reading a strategy the model wrote', () => {
  it('accepts the seven real ones unchanged', () => {
    for (const name of ['testId', 'role', 'label', 'placeholder', 'css', 'xpath', 'predicate']) {
      assert.equal(normaliseStrategy(name), name);
    }
  });

  it('maps "text" to label — both mean the visible string', () => {
    assert.equal(normaliseStrategy('text'), 'label');
  });

  it('forgives casing and punctuation rather than losing the candidate', () => {
    assert.equal(normaliseStrategy('TestID'), 'testId');
    assert.equal(normaliseStrategy('data-testid'), 'testId');
    assert.equal(normaliseStrategy('accessibility-id'), 'testId');
    assert.equal(normaliseStrategy('  label  '), 'label');
  });

  it('refuses to guess at something with no clear meaning', () => {
    // "class" could be css or a widget role; picking one would silently write a
    // locator the document never justified.
    assert.equal(normaliseStrategy('class'), undefined);
    assert.equal(normaliseStrategy('nearby'), undefined);
  });
});

describe('what an unusable candidate costs', () => {
  it('is dropped, not fatal', () => {
    const result = toCandidate({ strategy: 'nearby', value: 'x', weight: 0.5 }, 'p.x');
    assert.equal(result, undefined);
  });

  it('keeps the rest of the element usable', () => {
    const good = toCandidate({ strategy: 'text', value: 'Thêm mã', weight: 0.8 }, 'p.x');
    assert.equal(good?.strategy, 'label');
    assert.equal(good?.value, 'Thêm mã');
    assert.equal(good?.origin, 'llm');
  });

  it('falls back to a middling weight rather than NaN', () => {
    const c = toCandidate({ strategy: 'label', value: 'x', weight: 'rất cao' }, 'p.x');
    assert.equal(c?.weight, 0.5);
  });
});
