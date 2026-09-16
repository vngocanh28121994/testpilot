import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RawEl } from '../domObserve.js';
import { rawDomElementToObservedElement } from '../WebViewCdpDriver.js';

function raw(overrides: Partial<RawEl> = {}): RawEl {
  return {
    tag: 'div',
    interactive: false,
    container: false,
    disabled: false,
    visible: true,
    rect: { x: 0, y: 0, width: 100, height: 20 },
    ...overrides,
  };
}

describe('WebViewCdpDriver observation locators', () => {
  it('does not turn a shared component class into an element locator', () => {
    const observed = rawDomElementToObservedElement(raw({
      domText: 'Lợi nhuận theo tháng',
      cssClasses: 'name',
      // Undefined means the in-page observer found no unique CSS selector.
      css: undefined,
    }), 3);

    assert.equal(observed.text, 'Lợi nhuận theo tháng');
    assert.equal(observed.css, undefined);
  });

  it('preserves CSS that the in-page observer proved unique', () => {
    const observed = rawDomElementToObservedElement(raw({
      domText: 'Thêm mới',
      cssClasses: 'btn-primary',
      css: 'button.btn-add-report',
      tag: 'button',
      interactive: true,
    }), 4);

    assert.equal(observed.css, 'button.btn-add-report');
    assert.equal(observed.interactive, true);
  });
});
