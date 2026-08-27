/**
 * What a control is called, against a real DOM.
 *
 * A `<mat-select>` reads back its *value*, not its name: the source-account
 * dropdown on the transfer screen returns "TK Thường", the account somebody
 * picked, while the string that says which control it is — "Chuyển từ" — lives
 * in a separate label node. Verifying that control against its own value
 * rejected the correct element on every attempt, and every scenario touching
 * the dropdown failed on Android while the same suite passed on the web.
 *
 * The markup below is the shape that failed, taken from the page dump of that
 * run: Material points `aria-labelledby` at the label node *and* the value
 * node, which is why picking the first id blindly reintroduces the bug.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';

import { accessibleNameOf } from '../accessibleName.js';

let browser: Browser;
let page: Page;

const nameOf = (selector: string): Promise<string | undefined> =>
  page.locator(selector).evaluate(accessibleNameOf);

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => { await browser?.close(); });

describe('the accessible name of a control', () => {
  it('prefers the label node when aria-labelledby also points at the value', async () => {
    await page.setContent(`
      <mat-form-field>
        <mat-select id="sel" role="combobox"
                    aria-labelledby="lbl val">
          <div id="val" class="mat-select-value">TK Thường</div>
        </mat-select>
        <label id="lbl"><mat-label>Chuyển từ</mat-label></label>
      </mat-form-field>
    `);
    assert.equal(await nameOf('#sel'), 'Chuyển từ');
  });

  it('uses aria-label when there is one', async () => {
    await page.setContent(`<button id="b" aria-label="Đóng">✕</button>`);
    assert.equal(await nameOf('#b'), 'Đóng');
  });

  it('falls back to the wrapping form field', async () => {
    // Controls that point at nothing still sit inside a field that names them.
    await page.setContent(`
      <mat-form-field><mat-label>Số tiền</mat-label><input id="i" value="1,000"></mat-form-field>
    `);
    assert.equal(await nameOf('#i'), 'Số tiền');
  });

  it('finds a label bound by `for`', async () => {
    await page.setContent(`<label for="x">Ghi chú</label><input id="x" value="abc">`);
    assert.equal(await nameOf('#x'), 'Ghi chú');
  });

  it('returns nothing when the element has no name, rather than its contents', async () => {
    // Reporting the value here is what broke: an unnamed control must be
    // reported as unnamed so the caller falls back to its own text check.
    await page.setContent(`<div id="d">TK Thường</div>`);
    assert.equal(await nameOf('#d'), undefined);
  });

  it('collapses the whitespace a template leaves behind', async () => {
    await page.setContent(`
      <label for="y">
        Chuyển   từ
      </label><input id="y">
    `);
    assert.equal(await nameOf('#y'), 'Chuyển từ');
  });

  it('is a function, not a string — a string comes back undefined', async () => {
    // The first version of this module exported source text. `locator.evaluate`
    // evaluates a string as an expression and serialises the resulting function
    // as the return value, so every element reported no name at all. Passing
    // the function itself is the whole difference.
    await page.setContent(`<button id="b" aria-label="Đóng">✕</button>`);
    assert.equal(typeof accessibleNameOf, 'function');
    const asString = await page
      .locator('#b')
      .evaluate('(node) => node.getAttribute("aria-label")' as never);
    assert.equal(asString, undefined);
  });
});
