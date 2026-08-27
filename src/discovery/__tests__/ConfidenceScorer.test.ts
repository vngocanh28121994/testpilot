import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfidenceScorer,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  textMatch,
} from '../ConfidenceScorer.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { ObservedElement } from '../UiObservation.js';

const scorer = new ConfidenceScorer();

function intent(partial: Partial<ElementIntent>): ElementIntent {
  return { id: 'test.element', action: 'tap', ...partial };
}

function element(partial: Partial<ObservedElement>): ObservedElement {
  return { id: 'el-1', visible: true, ...partial };
}

describe('ConfidenceScorer — natural-language labels', () => {
  // Steps name things the way a tester speaks. Every case here failed to score
  // at all before: the label describes the control instead of quoting it.
  const orderScreen: ObservedElement[] = [
    { id: 'oNhapMa', role: 'combobox', placeholder: 'Nhập mã', visible: true, enabled: true, interactive: true },
    { id: 'klDat', role: 'textbox', placeholder: '0', visible: true, enabled: true, interactive: true },
    { id: 'btnMua', role: 'button', text: 'MUA', visible: true, enabled: true, interactive: true },
  ];
  const typeStockCode = intent({ id: 'home.oNhapMaCoPhieu', label: 'Ô nhập mã cổ phiếu', action: 'input', screen: 'home' });

  it('credits a placeholder that the label describes rather than quotes', () => {
    const r = scorer.score(typeStockCode, orderScreen[0]!, { screen: 'home' });
    assert.ok(r.reasons.includes('placeholder partial match'), r.reasons.join(', '));
    assert.ok(r.reasons.includes('semantic role matches'), 'action implies the role');
  });

  it('refuses a button for a step that types', () => {
    const r = scorer.score(typeStockCode, orderScreen[2]!, { screen: 'home' });
    assert.equal(r.score, 0);
    assert.match(r.penalties.join(' '), /accepts input/);
  });

  it('separates the intended field from every other control on the screen', () => {
    const scored = orderScreen.map((el) => ({
      id: el.id,
      score: scorer.score(typeStockCode, el, { screen: 'home', allCandidates: orderScreen }).score,
    }));
    const target = scored.find((x) => x.id === 'oNhapMa')!;
    const others = scored.filter((x) => x.id !== 'oNhapMa');
    // A clear gap, not a tie: the two used to land on the same 15 points, which
    // is what made discovery useless for a screen with no testIds.
    assert.ok(
      others.every((o) => target.score - o.score >= 20),
      `expected a clear winner, got ${JSON.stringify(scored)}`,
    );
  });

  it('refuses a fragment of the label, however well it fits inside it', () => {
    // "Tìm kiếm" is inside "Kết quả tìm kiếm đầu tiên" and names something else.
    // Letting it through healed the first-search-result element into the search
    // box, and the next tap sat on an input until it timed out.
    const r = scorer.score(
      intent({ id: 'home.searchFirstResult', label: 'Kết quả tìm kiếm đầu tiên', action: 'tap', screen: 'home' }),
      element({ role: 'textbox', placeholder: 'Tìm kiếm', interactive: true }),
      { screen: 'home' },
    );
    assert.ok(!r.reasons.some((x) => x.startsWith('placeholder')), r.reasons.join(', '));
  });

  it('needs more than one shared word to call it a match', () => {
    // "mã" alone must not pair a step with every ticker field on the screen.
    const r = scorer.score(
      intent({ label: 'Ô nhập mã cổ phiếu', action: 'input', screen: 'home' }),
      element({ role: 'textbox', placeholder: 'mã', interactive: true }),
      { screen: 'home' },
    );
    assert.ok(!r.reasons.includes('placeholder partial match'), r.reasons.join(', '));
  });

  it('maps a contextual business label to a compact option token', () => {
    assert.equal(textMatch('1M', 'Giá 1M'), 'subset');
    assert.equal(textMatch('YTD', 'Kỳ YTD'), 'subset');
  });

  it('still rejects an ordinary single-word fragment', () => {
    assert.equal(textMatch('mã', 'Ô mã cổ phiếu'), 'none');
  });
});

describe('ConfidenceScorer — positive signals', () => {
  it('treats an autocomplete combobox as an input-compatible textbox', () => {
    const score = new ConfidenceScorer().score(
      { id: 'stock', action: 'input', semanticRole: 'textbox', placeholder: 'Mã cổ phiếu', screen: 'priceBoard' },
      { id: 'input', role: 'combobox', placeholder: 'Mã cổ phiếu', visible: true, enabled: true, interactive: true },
      { screen: 'priceBoard' },
    );
    assert.ok(score.score >= 50);
    assert.ok(score.reasons.includes('semantic role matches'));
  });
  it('exact testId match gives score >= exactTestId weight * 0.7', () => {
    const result = scorer.score(
      intent({ id: 'login.submitButton' }),
      element({ testId: 'submitButton' }),
    );
    assert.ok(
      result.score >= Math.floor(DEFAULT_WEIGHTS.exactTestId * 0.7),
      `score ${result.score} should be >= ${Math.floor(DEFAULT_WEIGHTS.exactTestId * 0.7)}`,
    );
    assert.ok(result.reasons.length > 0, 'should have at least one reason');
  });

  it('exact accessibility label match gives score >= exactAccessibility weight', () => {
    const result = scorer.score(
      intent({ label: 'Login Button' }),
      element({ accessibilityLabel: 'Login Button' }),
    );
    assert.ok(
      result.score >= DEFAULT_WEIGHTS.exactAccessibility,
      `score ${result.score} should be >= ${DEFAULT_WEIGHTS.exactAccessibility}`,
    );
    assert.ok(
      result.reasons.some((r) => r.includes('accessibility')),
      'reason should mention accessibility',
    );
  });

  it('exact text match gives score >= exactText weight', () => {
    const result = scorer.score(
      intent({ text: 'Sign In' }),
      element({ text: 'Sign In' }),
    );
    assert.ok(result.score >= DEFAULT_WEIGHTS.exactText);
  });

  it('matches Vietnamese tone-mark spelling variants on an interactive control', () => {
    const result = scorer.score(
      intent({ label: 'Xoá khỏi danh mục', screen: 'priceBoard' }),
      element({ text: 'Xóa khỏi danh mục', role: 'button', interactive: true }),
      { screen: 'priceBoard' },
    );
    assert.ok(result.score >= 40, `expected interactive exact-text score >= 40, got ${result.score}`);
    assert.ok(result.reasons.includes('exact text on interactive control'));
  });

  it('allows unique exact text on the current screen into read-only verification', () => {
    const result = scorer.score(
      intent({ action: 'assert-visible', label: 'ADS', screen: 'priceBoard' }),
      element({ text: 'ADS' }),
      { screen: 'priceBoard' },
    );
    assert.ok(result.score >= 40, `expected read-only score >= 40, got ${result.score}`);
    assert.ok(result.reasons.includes('exact text for read-only assertion'));
  });

  it('role match adds sameRole weight', () => {
    const without = scorer.score(intent({ semanticRole: 'button' }), element({}));
    const with_ = scorer.score(
      intent({ semanticRole: 'button' }),
      element({ role: 'button' }),
    );
    assert.ok(with_.score >= without.score + DEFAULT_WEIGHTS.sameRole);
    assert.ok(with_.reasons.some((r) => r.includes('role')));
  });

  it('historical winner adds historicalSuccess weight', () => {
    const base = scorer.score(intent({ label: 'Login' }), element({ accessibilityLabel: 'Login' }));
    const withHistory = scorer.score(
      intent({ label: 'Login' }),
      element({ accessibilityLabel: 'Login' }),
      { historicalWinner: true },
    );
    assert.ok(withHistory.score >= base.score + DEFAULT_WEIGHTS.historicalSuccess);
  });

  it('same-screen bonus applied when screens match', () => {
    const without = scorer.score(intent({ label: 'OK', screen: 'confirm' }), element({ text: 'OK' }));
    const withScreen = scorer.score(
      intent({ label: 'OK', screen: 'confirm' }),
      element({ text: 'OK' }),
      { screen: 'confirm' },
    );
    assert.ok(withScreen.score >= without.score + DEFAULT_WEIGHTS.sameScreen);
  });
});

describe('ConfidenceScorer — penalties', () => {
  it('hidden element incurs hiddenPenalty', () => {
    const result = scorer.score(
      intent({ label: 'Login' }),
      element({ accessibilityLabel: 'Login', visible: false }),
    );
    assert.ok(result.penalties.length > 0);
    assert.ok(result.penalties.some((p) => p.includes('not visible')));
    // Score is reduced by the penalty even if positive signals are present
    const noHide = scorer.score(
      intent({ label: 'Login' }),
      element({ accessibilityLabel: 'Login', visible: true }),
    );
    assert.ok(noHide.score > result.score);
  });

  it('disabled element incurs disabledPenalty', () => {
    const enabled = scorer.score(intent({ label: 'Submit' }), element({ text: 'Submit', enabled: true }));
    const disabled = scorer.score(intent({ label: 'Submit' }), element({ text: 'Submit', enabled: false }));
    assert.ok(enabled.score > disabled.score);
    assert.ok(disabled.penalties.some((p) => p.includes('disabled')));
  });

  it('duplicate text incurs duplicatePenalty', () => {
    const candidate = element({ id: 'el-1', text: 'Confirm' });
    const dup = element({ id: 'el-2', text: 'Confirm' });
    const result = scorer.score(intent({ label: 'Confirm' }), candidate, {
      allCandidates: [candidate, dup],
    });
    assert.ok(result.penalties.some((p) => p.includes('duplicate')));
  });

  it('container element (has children, not interactive) incurs containerPenalty', () => {
    const result = scorer.score(
      intent({ label: 'Panel' }),
      element({ text: 'Panel', childIds: ['child-1'], interactive: false }),
    );
    assert.ok(result.penalties.some((p) => p.includes('container')));
  });

  it('fragile xpath incurs fragileXpathPenalty', () => {
    const result = scorer.score(
      intent({ label: 'OK' }),
      element({ text: 'OK', xpath: '//div/div[2]/span[1]/button[3]' }),
    );
    assert.ok(result.penalties.some((p) => p.includes('fragile')));
  });
});

describe('ConfidenceScorer — verdict thresholds', () => {
  it('score >= autoAccept returns "accept"', () => {
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.autoAccept), 'accept');
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.autoAccept + 20), 'accept');
  });

  it('score in [requireVerification, autoAccept) returns "verify"', () => {
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.requireVerification), 'verify');
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.autoAccept - 1), 'verify');
  });

  it('score < requireVerification returns "reject"', () => {
    assert.equal(scorer.verdict(DEFAULT_THRESHOLDS.requireVerification - 1), 'reject');
    assert.equal(scorer.verdict(0), 'reject');
    assert.equal(scorer.verdict(-10), 'reject');
  });
});

describe('ConfidenceScorer — custom weights', () => {
  it('custom weights override defaults', () => {
    const custom = new ConfidenceScorer(
      { ...DEFAULT_WEIGHTS, exactAccessibility: 99 },
      DEFAULT_THRESHOLDS,
    );
    const result = custom.score(
      intent({ label: 'Login' }),
      element({ accessibilityLabel: 'Login' }),
    );
    assert.ok(result.score >= 99, `expected score >= 99, got ${result.score}`);
  });

  it('custom thresholds change verdict boundaries', () => {
    const custom = new ConfidenceScorer(DEFAULT_WEIGHTS, { autoAccept: 50, requireVerification: 30 });
    assert.equal(custom.verdict(50), 'accept');
    assert.equal(custom.verdict(30), 'verify');
    assert.equal(custom.verdict(29), 'reject');
  });
});

describe('textMatch: head word past the verb', () => {
  // A field is named for what it holds, not for what you do to it. Stopping the
  // head at the verb rejected the field the step meant and accepted an
  // unrelated one that merely shared the verb — the failure that made a whole
  // suite fail on its first step.
  it('accepts the field whose caption names the content', () => {
    assert.equal(textMatch('Mã cổ phiếu', 'Ô tìm kiếm mã cổ phiếu'), 'subset');
    assert.equal(textMatch('Mã cổ phiếu', 'Ô mã cổ phiếu'), 'subset');
    assert.equal(textMatch('Nhập mã', 'Ô nhập mã cổ phiếu'), 'subset');
  });

  it('rejects a different control that only shares the verb', () => {
    // The global search box, three columns away on the same screen.
    assert.equal(textMatch('Tìm kiếm', 'Ô tìm kiếm mã cổ phiếu'), 'none');
  });

  it('still keeps a result apart from the box that produced it', () => {
    // The case the head-word rule was written for; it must survive the change.
    assert.equal(textMatch('Tìm kiếm', 'Kết quả tìm kiếm đầu tiên'), 'none');
    assert.equal(textMatch('Ô tìm kiếm', 'Kết quả tìm kiếm đầu tiên'), 'none');
  });

  it('does not match everything when a label is nothing but framing words', () => {
    assert.equal(textMatch('Giá đặt', 'Ô nhập'), 'none');
  });
});

describe('role compatibility for ordinary web controls', () => {
  const field = {
    id: 'e1', role: 'input', placeholder: 'Mã cổ phiếu',
    visible: true, enabled: true, interactive: true,
  };
  const intent = {
    id: 'addStockModal.searchInput',
    label: 'Ô tìm kiếm mã cổ phiếu',
    action: 'input',
    screen: 'addStockModal',
  } as ElementIntent;

  it('credits a plain <input> for an input step', () => {
    // The web observer reports the tag, not an ARIA role the page never set.
    // Without `input` in the compatible list the role signal never fired for
    // the commonest control on the web, and the weights are calibrated as
    // though it does — leaving a correct field below the accept threshold.
    const scored = new ConfidenceScorer().score(
      intent, field as never, { screen: 'addStockModal' } as never,
    );
    assert.ok(scored.reasons.includes('semantic role matches'), JSON.stringify(scored));
    assert.ok(scored.score >= 40, `điểm ${scored.score} phải đạt ngưỡng chấp nhận`);
  });

  it('still ranks an unrelated input on the same screen below it', () => {
    const other = { ...field, id: 'e2', placeholder: 'Tìm kiếm' };
    const scorer = new ConfidenceScorer();
    const right = scorer.score(intent, field as never, { screen: 'addStockModal' } as never);
    const wrong = scorer.score(intent, other as never, { screen: 'addStockModal' } as never);
    assert.ok(right.score > wrong.score, `${right.score} phải hơn ${wrong.score}`);
    assert.ok(wrong.score < 40, 'phần tử sai phải nằm dưới ngưỡng');
  });
});
