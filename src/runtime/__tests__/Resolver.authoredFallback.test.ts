/**
 * An element's own second-choice locator is not a guess.
 *
 * The registry lists candidates in priority order, and that ordering *is* the
 * fallback plan someone wrote down. Semantic verification exists for locators
 * nobody authored — the ones discovery invents mid-run — but it was applied to
 * anything that was not the *first* candidate, which quietly cancelled the plan.
 *
 * It cancelled it on the mobile web build: `role=combobox` matches three
 * controls on the transfer screen so it resolves to nothing, `label=Chuyển từ`
 * finds the right one every time, and every time it was discarded. Verification
 * could not save it either, because a `<mat-select>` reads back its value
 * ("TK Thường") rather than its name ("Chuyển từ"). Every scenario touching
 * that dropdown failed on Android while the same suite passed on the web.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Registry } from '../../core/registry.js';
import type { LocatorCandidate } from '../../core/types.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import { Resolver } from '../resolver.js';

const primary: LocatorCandidate = {
  strategy: 'role', value: 'combobox', weight: 0.9, origin: 'llm',
};
const authoredFallback: LocatorCandidate = {
  strategy: 'label', value: 'Chuyển từ', weight: 0.8, origin: 'llm',
};

/**
 * A handle whose text is the control's value, as a real select's is. Nothing
 * about it matches the expected label, so anything that must pass verification
 * on text alone will be rejected.
 */
function selectHandle(candidate: LocatorCandidate): UiHandle {
  return { candidate, isVisible: async () => true, text: async () => 'TK Thường' };
}

function driverThatOnlyKnows(match: LocatorCandidate): UiDriver {
  return {
    platform: 'web',
    device: 'test',
    start: async () => {}, stop: async () => {}, launch: async () => {},
    find: async (c: LocatorCandidate) =>
      c.strategy === match.strategy && c.value === match.value ? selectHandle(c) : null,
    tap: async () => {}, longPress: async () => {}, input: async () => {},
    clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
    swipe: async () => {}, scroll: async () => {}, back: async () => {},
    screenshot: async () => '', isIdle: async () => true,
  } as unknown as UiDriver;
}

async function registryWithBoth(): Promise<Registry> {
  const reg = await Registry.load('/dev/null/nonexistent-registry.json');
  reg.upsertElement({
    id: 'transfer.sourceAccount',
    label: 'Chuyển từ',
    screen: 'transfer',
    candidates: { web: [primary, authoredFallback] },
  });
  return reg;
}

const options = { timeoutMs: 300, pollMs: 50, requireVisible: false, verifyHealedMatch: true };

describe('an authored fallback candidate', () => {
  it('is accepted when the primary matches nothing', async () => {
    const reg = await registryWithBoth();
    const resolver = new Resolver(driverThatOnlyKnows(authoredFallback), reg, options);

    const r = await resolver.resolve('transfer.sourceAccount');
    assert.equal(r.candidate.strategy, 'label');
    assert.equal(r.candidate.value, 'Chuyển từ');
  });

  it('is still reported as a heal, so the primary failing stays visible', async () => {
    // The gate changed; the telemetry did not. A non-primary win is worth
    // recording either way — it is how a stale primary gets noticed.
    const reg = await registryWithBoth();
    const resolver = new Resolver(driverThatOnlyKnows(authoredFallback), reg, options);

    const r = await resolver.resolve('transfer.sourceAccount');
    assert.equal(r.healed, true);
    assert.deepEqual(r.previous, primary);
  });

  it('needs no verification, even when its text cannot possibly match the label', async () => {
    // The handle reads "TK Thường" against an expected label of "Chuyển từ".
    // Under the old rule that mismatch was fatal; the point of the fix is that
    // an authored locator is never asked to prove itself this way.
    const reg = await registryWithBoth();
    const resolver = new Resolver(driverThatOnlyKnows(authoredFallback), reg, options);

    const r = await resolver.resolve('transfer.sourceAccount');
    assert.equal(await r.handle.text(), 'TK Thường');
  });

  it('leaves the primary as the primary when it does match', async () => {
    const reg = await registryWithBoth();
    const resolver = new Resolver(driverThatOnlyKnows(primary), reg, options);

    const r = await resolver.resolve('transfer.sourceAccount');
    assert.equal(r.candidate.strategy, 'role');
    assert.equal(r.healed, false);
  });
});
