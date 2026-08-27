/**
 * Reading the value that belongs to a caption, against a real DOM.
 *
 * A confirmation screen in this application is two columns of plain divs:
 * "Lệnh" beside "Chuyển tiền", "Được chuyển" beside "8,829". A step written as
 * `"Lệnh" shows "Chuyển tiền"` means the field named Lệnh, but the locator
 * matches the text Lệnh — so the assertion compared the caption with the value
 * and failed on three of four scenarios in one feature, on every confirmation
 * row the app has.
 *
 * The markup here is the shape that failed. The rules are deliberately
 * structural rather than class-based: class names differ per screen, and a
 * matcher tuned to one of them would go stale the first time the app is
 * restyled.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { WebUiDriver } from '../web.js';

let browser: Browser;
let page: Page;
let driver: WebUiDriver;

/** Calls the driver's script against whichever node the selector picks. */
async function valueBeside(selector: string): Promise<string | undefined> {
  const handle = { locator: page.locator(selector), candidate: {} } as never;
  return (driver as unknown as {
    captionValue(h: never): Promise<string | undefined>;
  }).captionValue(handle);
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  driver = new WebUiDriver({ baseUrl: 'http://localhost', artifactsDir: '/tmp' });
  (driver as unknown as { page: Page }).page = page;
});

after(async () => { await browser?.close(); });

describe('a caption and its value', () => {
  it('reads the sibling in a flat two-column row', async () => {
    await page.setContent(`
      <div class="row"><div id="cap">Lệnh</div><div>Chuyển tiền</div></div>
    `);
    assert.equal(await valueBeside('#cap'), 'Chuyển tiền');
  });

  it('reads across one level of per-cell wrappers', async () => {
    // The same pair, each half wrapped — the layout most of these screens use.
    await page.setContent(`
      <div class="row">
        <div class="cell"><span id="cap">Được chuyển</span></div>
        <div class="cell"><span>8,829</span></div>
      </div>
    `);
    assert.equal(await valueBeside('#cap'), '8,829');
  });

  it('skips an empty spacer between the two', async () => {
    await page.setContent(`
      <div class="row"><div id="cap">Lệnh</div><div></div><div>Chuyển tiền</div></div>
    `);
    assert.equal(await valueBeside('#cap'), 'Chuyển tiền');
  });

  it('ignores a node that merely repeats the caption', async () => {
    // Some rows render the label twice for narrow layouts. Returning it would
    // report the caption as though it were the value and pass nothing useful.
    await page.setContent(`
      <div class="row"><div id="cap">Lệnh</div><div>Lệnh</div><div>Chuyển tiền</div></div>
    `);
    assert.equal(await valueBeside('#cap'), 'Chuyển tiền');
  });
});

describe('text the value node carries but does not mean', () => {
  it('strips a Material icon ligature out of the value', async () => {
    // An icon's text content is its ligature name, so the refresh button in the
    // same cell made a balance read "refresh7,329" — a value no assertion could
    // ever match, from a mechanism that had otherwise worked.
    await page.setContent(`
      <div class="row">
        <div id="cap">Được chuyển</div>
        <div><mat-icon class="mat-icon">refresh</mat-icon><span>7,329</span></div>
      </div>
    `);
    assert.equal(await valueBeside('#cap'), '7,329');
  });

  it('leaves the live DOM untouched while doing it', async () => {
    await page.setContent(`
      <div class="row">
        <div id="cap">Được chuyển</div>
        <div id="val"><mat-icon class="mat-icon">refresh</mat-icon><span>7,329</span></div>
      </div>
    `);
    await valueBeside('#cap');
    assert.equal(await page.locator('#val mat-icon').count(), 1, 'icon phải còn nguyên trên trang');
  });
});

describe('where it refuses to reach', () => {
  it('does not climb far enough to grab the next row', async () => {
    // Three levels up, the "next element" is another row entirely, whose value
    // belongs to a different caption — a confidently wrong answer, which is
    // worse than none.
    await page.setContent(`
      <div class="page">
        <div class="section"><div class="row"><div id="cap">Lệnh</div></div></div>
        <div class="section"><div class="row"><div>Được chuyển</div><div>8,829</div></div></div>
      </div>
    `);
    assert.equal(await valueBeside('#cap'), undefined);
  });

  it('returns nothing when the caption is the last thing on the row', async () => {
    await page.setContent('<div class="row"><div id="cap">Lệnh</div></div>');
    assert.equal(await valueBeside('#cap'), undefined);
  });
});
