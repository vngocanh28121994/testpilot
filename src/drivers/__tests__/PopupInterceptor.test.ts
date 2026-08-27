import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { PopupInterceptor } from '../PopupInterceptor.js';

describe('PopupInterceptor', () => {
  it('clears semantic popup layers from top to bottom', async () => {
    const results = [
      { root: 'mat-dialog-container', control: 'CLOSE', source: 'semantic' as const },
      { root: 'dialog', control: 'BỎ QUA', source: 'semantic' as const },
      null,
    ];
    const messages: string[] = [];
    const page = {
      evaluate: async () => results.shift() ?? null,
      waitForTimeout: async () => {},
      locator: () => { throw new Error('configured fallback should not run'); },
    } as unknown as Page;

    const interceptor = new PopupInterceptor([], (message) => messages.push(message));
    assert.equal(await interceptor.clear(page), 2);
    assert.equal(messages.length, 2);
  });

  it('uses a configured fallback only when its close control is topmost', async () => {
    let clicked = false;
    let evaluated = 0;
    const dismiss = {
      isVisible: async () => true,
      click: async (opts: { trial?: boolean }) => {
        if (!opts.trial) clicked = true;
      },
    };
    const page = {
      evaluate: async () => {
        evaluated += 1;
        return null;
      },
      locator: (selector: string) => ({
        first: () => selector === '.popup'
          ? { isVisible: async () => true }
          : dismiss,
      }),
    } as unknown as Page;

    const interceptor = new PopupInterceptor([
      { detect: '.popup', dismiss: '.popup .close' },
    ], () => {});
    const result = await interceptor.dismissOne(page);
    assert.equal(result?.source, 'configured');
    assert.equal(clicked, true);
    // The next action must not immediately perform the expensive semantic DOM
    // scan after this precise rule already closed the known popup.
    assert.equal(await interceptor.dismissOne(page, ['text=another action target']), null);
    assert.equal(evaluated, 0);
  });

  it('does not click a configured control covered by another layer', async () => {
    let clicked = false;
    const page = {
      evaluate: async () => null,
      locator: (selector: string) => ({
        first: () => selector === '.popup'
          ? { isVisible: async () => true }
          : {
              isVisible: async () => true,
              click: async (opts: { trial?: boolean }) => {
                if (opts.trial) throw new Error('covered');
                clicked = true;
              },
            },
      }),
    } as unknown as Page;

    const interceptor = new PopupInterceptor([
      { detect: '.popup', dismiss: '.popup .close' },
    ], () => {});
    assert.equal(await interceptor.dismissOne(page), null);
    assert.equal(clicked, false);
  });

  it('caches a negative scan but allows an actionability failure to force recheck', async () => {
    let evaluations = 0;
    const page = {
      evaluate: async () => {
        evaluations += 1;
        return null;
      },
    } as unknown as Page;
    const interceptor = new PopupInterceptor([], () => {});

    assert.equal(await interceptor.dismissOne(page), null);
    assert.equal(await interceptor.dismissOne(page), null);
    assert.equal(evaluations, 1);

    assert.equal(await interceptor.dismissOne(page, [], { force: true }), null);
    assert.equal(evaluations, 2);
  });
});
