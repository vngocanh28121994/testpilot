import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAwsLifecycle, formatTestPilotCases } from '../devicefarm.js';

describe('Device Farm result counters', () => {
  it('labels AWS counters as lifecycle rather than TestPilot testcases', () => {
    assert.equal(
      formatAwsLifecycle('COMPLETED', { passed: 4, failed: 2, total: 6 }),
      'AWS Device Farm: COMPLETED — lifecycle 4 passed / 2 failed / tổng 6 mục ' +
        '(Setup, Tests, Teardown; không phải testcase TestPilot)',
    );
  });

  it('does not print a misleading zero total while AWS is scheduling', () => {
    assert.equal(
      formatAwsLifecycle('SCHEDULING', { passed: 0, failed: 0, total: 0 }),
      'AWS Device Farm: SCHEDULING',
    );
  });

  it('counts granular TestPilot verdicts and calls out known issues', () => {
    const results = [
      ...Array.from({ length: 8 }, () => ({ verdict: 'passed' })),
      ...Array.from({ length: 2 }, () => ({ verdict: 'failed' })),
    ];
    assert.equal(
      formatTestPilotCases(
        'Google Pixel 11 Pro XL',
        { report: { results } },
        { counters: { failed: 1 } },
      ),
      'TestPilot testcase — Google Pixel 11 Pro XL: 8 passed / 2 failed / tổng 10 testcase ' +
        '(1 known issue).',
    );
  });
});
