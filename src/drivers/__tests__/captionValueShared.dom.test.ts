/**
 * Reading the value beside a caption — the same function on every driver.
 *
 * This logic lived only in the Playwright driver. The WebView driver had none,
 * and `readTexts` skips the whole caption fallback when the driver cannot do
 * it, so on Android `remember "Được chuyển"` stored the words "Được chuyển"
 * and the assertion that followed died in `parseDisplayedNumber`:
 *
 *     Không tìm thấy giá trị số trong "Được chuyển".
 *
 * Four of nine scenarios failed that way in one run, and `"Lệnh" shows
 * "Chuyển tiền"` failed for the same reason with a different message — it read
 * the caption "Lệnh" twice and compared it with the value it was looking for.
 *
 * The markup below is the shape from that application, so a driver that passes
 * these reads the confirmation screen the same way everywhere.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';

import { valueBesideCaption } from '../captionValue.js';

let browser: Browser;
let page: Page;

const beside = async (selector: string): Promise<string | undefined> => {
  const locator = page.locator(selector);
  const caption = await locator.innerText();
  return locator.evaluate(valueBesideCaption, caption);
};

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => { await browser?.close(); });

describe('the value beside a caption', () => {
  it('reads the sibling in a flat two-column row', async () => {
    await page.setContent(`<div><div id="cap">Lệnh</div><div>Chuyển tiền</div></div>`);
    assert.equal(await beside('#cap'), 'Chuyển tiền');
  });

  it('reads across one level of per-cell wrappers', async () => {
    // The transfer screen's own layout: caption and value each in their own
    // column div, which is why one level of walking is not enough.
    await page.setContent(`
      <div class="row">
        <div class="col"><span id="cap">Được chuyển</span></div>
        <div class="col"><span>2,829</span></div>
      </div>
    `);
    assert.equal(await beside('#cap'), '2,829');
  });

  it('ignores a Material icon sharing the cell', async () => {
    // An icon's text content is its ligature name, so the refresh button beside
    // the balance turns "2,829" into "refresh2,829".
    await page.setContent(`
      <div><span id="cap">Được chuyển</span></div>
      <div><mat-icon>refresh</mat-icon><span>2,829</span></div>
    `);
    assert.equal(await beside('#cap'), '2,829');
  });

  it('does not return the caption repeated back', async () => {
    // A layout that echoes the caption must not be mistaken for a value — that
    // is precisely the failure this exists to prevent.
    await page.setContent(`<div><div id="cap">Được chuyển</div><div>Được chuyển</div></div>`);
    assert.equal(await beside('#cap'), undefined);
  });

  it('stops before the next row rather than borrowing its value', async () => {
    // Beyond two levels the "next element" is a different row entirely, and its
    // value would be confidently wrong.
    await page.setContent(`
      <table><tbody>
        <tr><td><div><span id="cap">Được chuyển</span></div></td></tr>
        <tr><td>9,999</td></tr>
      </tbody></table>
    `);
    assert.equal(await beside('#cap'), undefined);
  });
});
