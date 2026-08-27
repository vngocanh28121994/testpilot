/**
 * Telling a product rule from somebody's account balance.
 *
 * A generated scenario asserted `"Được chuyển" shows "8,829"`, copied from a
 * figure the source document happened to quote. The scenario then transferred
 * 1,000, the balance moved, and the assertion was wrong forever after — while
 * the application did exactly what it was built to do. Each rerun made it more
 * wrong: 7,329, 5,329, 1,329.
 *
 * The test is who produced the number. One the scenario typed in is a real
 * claim; one that appeared from nowhere is account state, which differs on
 * every run and every environment.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { absoluteValueWarnings } from '../absoluteValues.js';
import type { FeatureSpec, Intent, ScenarioSpec, StepSpec } from '../../core/types.js';

const step = (intent: Intent, line = 1): StepSpec => ({
  text: 'step', keyword: 'When', line, intent,
});

const scenario = (name: string, steps: StepSpec[], id = 's'): ScenarioSpec => ({
  id, name, tags: [], platforms: ['web'], steps,
});

const feature = (steps: StepSpec[]): FeatureSpec => ({
  uri: 'f.feature',
  name: 'F',
  background: [],
  scenarios: [scenario('Chuyển tiền thành công', steps)],
} as FeatureSpec);

describe('a number the scenario never entered', () => {
  it('is reported', () => {
    const warnings = absoluteValueWarnings(feature([
      step({ kind: 'input', element: 'transfer.soTien', text: '1000' }, 12),
      step({ kind: 'assertText', element: 'transfer.availableAmount', text: '8,829', mode: 'contains' }, 22),
    ]));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Dòng 22/);
    assert.match(warnings[0]!, /I remember/);
  });

  it('names the scenario, so a reviewer can find it', () => {
    const [warning] = absoluteValueWarnings(feature([
      step({ kind: 'assertText', element: 'x', text: '8,829', mode: 'contains' }, 5),
    ]));
    assert.match(warning!, /Chuyển tiền thành công/);
  });
});

describe('a number the scenario did enter', () => {
  it('is left alone', () => {
    // Typing 1,000 and checking the confirmation shows 1,000 is a real claim
    // about the product, not a snapshot of an account.
    const warnings = absoluteValueWarnings(feature([
      step({ kind: 'input', element: 'transfer.soTien', text: '1000' }, 12),
      step({ kind: 'assertText', element: 'transfer.tienChuyen', text: '1,000', mode: 'contains' }, 19),
    ]));
    assert.deepEqual(warnings, []);
  });

  it('matches across separator styles, since the screen formats what was typed', () => {
    const warnings = absoluteValueWarnings(feature([
      step({ kind: 'input', element: 'x', text: '1234567' }, 1),
      step({ kind: 'assertText', element: 'y', text: '1,234,567', mode: 'contains' }, 2),
    ]));
    assert.deepEqual(warnings, []);
  });
});

describe('what is not a number at all', () => {
  it('ignores tickers, names and codes', () => {
    for (const text of ['VIC', 'MEL-HNX', 'Chuyển tiền', 'Ký Quỹ']) {
      assert.deepEqual(
        absoluteValueWarnings(feature([
          step({ kind: 'assertText', element: 'x', text, mode: 'contains' }, 1),
        ])),
        [],
        `"${text}" không phải con số`,
      );
    }
  });

  it('ignores a date, which reads numeric but is not an amount', () => {
    assert.deepEqual(
      absoluteValueWarnings(feature([
        step({ kind: 'assertText', element: 'x', text: '26/08/2026', mode: 'contains' }, 1),
      ])),
      [],
    );
  });

  it('ignores a negative assertion, where the number is what must not appear', () => {
    assert.deepEqual(
      absoluteValueWarnings(feature([
        step({ kind: 'assertText', element: 'x', text: '8,829', mode: 'notContains' }, 1),
      ])),
      [],
    );
  });
});

describe('scenarios are judged separately', () => {
  it('does not let one scenario\'s input excuse another\'s assertion', () => {
    const spec = feature([
      step({ kind: 'assertText', element: 'x', text: '8,829', mode: 'contains' }, 5),
    ]);
    spec.scenarios.push(
      scenario('Khác', [step({ kind: 'input', element: 'y', text: '8829' }, 9)], 's2'),
    );
    assert.equal(absoluteValueWarnings(spec).length, 1);
  });
});
