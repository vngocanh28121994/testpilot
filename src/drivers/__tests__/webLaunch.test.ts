import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebUiDriver } from '../web.js';

function driverWithPage(page: Record<string, unknown>): WebUiDriver {
  const driver = new WebUiDriver({
    baseUrl: 'https://app.example.test/',
    artifactsDir: '/tmp/testpilot-web-launch',
  });
  (driver as unknown as { page: Record<string, unknown> }).page = page;
  return driver;
}

describe('WebUiDriver — resilient launch', () => {
  it('continues after a navigation timeout when the expected app already painted', async () => {
    let calls = 0;
    const driver = driverWithPage({
      goto: async () => {
        calls += 1;
        throw new Error('page.goto: Timeout 60000ms exceeded.');
      },
      url: () => 'https://app.example.test/home',
      evaluate: async () => true,
    });

    await driver.launch();
    assert.equal(calls, 1);
  });

  it('retries one transient network change when no usable document exists yet', async () => {
    let calls = 0;
    const driver = driverWithPage({
      goto: async () => {
        calls += 1;
        if (calls === 1) throw new Error('page.goto: net::ERR_NETWORK_CHANGED');
      },
      url: () => 'about:blank',
      evaluate: async () => false,
    });

    await driver.launch();
    assert.equal(calls, 2);
  });

  it('does not hide a non-transient navigation failure', async () => {
    let calls = 0;
    const driver = driverWithPage({
      goto: async () => {
        calls += 1;
        throw new Error('page.goto: net::ERR_CERT_AUTHORITY_INVALID');
      },
      url: () => 'about:blank',
      evaluate: async () => false,
    });

    await assert.rejects(() => driver.launch(), /ERR_CERT_AUTHORITY_INVALID/);
    assert.equal(calls, 1);
  });
});
