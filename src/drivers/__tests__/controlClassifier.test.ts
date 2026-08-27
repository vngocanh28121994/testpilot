import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyControlFacts,
  looksLikeDate,
  performAdaptiveInput,
} from '../controlClassifier.js';
import type { UiDriver, UiHandle } from '../driver.js';
import type { LocatorCandidate } from '../../core/types.js';

const candidate: LocatorCandidate = {
  strategy: 'testId', value: 'from-date', weight: 1, origin: 'authored',
};
const handle: UiHandle = {
  candidate,
  isVisible: async () => true,
  text: async () => '',
};

function driver(calls: string[]): UiDriver {
  return {
    platform: 'web', device: 'mock',
    start: async () => {}, stop: async () => {}, launch: async () => {},
    find: async () => handle, tap: async () => {}, longPress: async () => {},
    input: async (_handle, value) => { calls.push(`input:${value}`); },
    selectDate: async (_handle, value) => { calls.push(`date:${value}`); },
    inspectControl: async () => ({
      type: 'date',
      evidence: ['playwright-dom: data-mat-calendar', 'playwright-mcp: calendar button'],
    }),
    clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
    swipe: async () => {}, scroll: async () => {}, back: async () => {},
    screenshot: async () => '', isIdle: async () => true,
  };
}

describe('runtime control classifier', () => {
  it('classifies an Angular Material readonly field as a date picker', () => {
    const result = classifyControlFacts({
      tag: 'input', type: 'text', role: '', readOnly: true,
      dataMatCalendar: true, calendarToggle: true,
    });
    assert.equal(result.type, 'date');
    assert.ok(result.evidence.includes('playwright-dom: data-mat-calendar'));
  });

  it('recognises business date formats without matching ordinary text', () => {
    assert.equal(looksLikeDate('01/01/2026'), true);
    assert.equal(looksLikeDate('2026-01-01'), true);
    assert.equal(looksLikeDate('Hiệu quả đầu tư'), false);
  });

  it('upgrades generic input to selectDate after runtime inspection', async () => {
    const calls: string[] = [];
    const result = await performAdaptiveInput(driver(calls), handle, '01/01/2026', undefined);
    assert.equal(result.action, 'selectDate');
    assert.deepEqual(calls, ['date:01/01/2026']);
    assert.ok(result.inspection?.evidence.some((item) => item.startsWith('playwright-mcp:')));
  });

  it('keeps ordinary text input on the fast path without inspecting', async () => {
    const calls: string[] = [];
    const result = await performAdaptiveInput(driver(calls), handle, 'ADS', 50);
    assert.equal(result.action, 'input');
    assert.deepEqual(calls, ['input:ADS']);
  });
});
