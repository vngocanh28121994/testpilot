/**
 * Finding an element by the text a person reads on it.
 *
 * The markup here is copied from a captured TCInvest confirmation screen. It
 * defeats both XPath arms the driver had, each for a different reason: Angular
 * interpolates the fee into its own `<span>`, so no node owns the whole string
 * `Tiền chuyển (Phí = 0)`; and the div that does own it also holds a tooltip,
 * so its concatenated text is the label plus a paragraph. The element resolved
 * as absent while sitting in plain view, and three scenarios failed on it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, selectors, type Browser, type Page } from 'playwright';
import { VISIBLE_TEXT_ENGINE } from '../web.js';

let browser: Browser;
let page: Page;

before(async () => {
  await selectors.register('visibletext', { content: VISIBLE_TEXT_ENGINE });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => { await browser?.close(); });

/** The real confirmation row: split label, tooltip, value underneath. */
const CONFIRM_ROW = `
  <div class="row pull-left p-b-24">
    <div class="row" id="caption">
      <span>Tiền chuyển (Phí = </span><span class="ng-star-inserted">0)</span>
      <div class="tooltip title-tooltip-content">
        <div>Phí chuyển tiền là phí do ngân hàng quy định, TCBS là đơn vị thu hộ</div>
      </div>
    </div>
    <div class="row p-t-4"><span>1,000</span></div>
  </div>
`;

describe('the label that used to be unreachable', () => {
  it('finds a label split across interpolated spans', async () => {
    await page.setContent(CONFIRM_ROW);
    const found = page.locator('visibletext=Tiền chuyển (Phí = 0)');
    assert.equal(await found.count(), 1);
    assert.equal(await found.getAttribute('id'), 'caption');
  });

  it('ignores the tooltip sharing the element', async () => {
    // Concatenated, this node reads "Tiền chuyển (Phí = 0)Phí chuyển tiền là
    // phí do ngân hàng…" — which is why matching on string-value failed.
    await page.setContent(CONFIRM_ROW);
    assert.equal(await page.locator('visibletext=Tiền chuyển (Phí = 0)').count(), 1);
  });

  it('leaves the value reachable beside it', async () => {
    // The point of finding the caption at all: the value lives next door, and
    // the assertion path reads it from there.
    await page.setContent(CONFIRM_ROW);
    const value = await page.locator('#caption').evaluate(
      (node) => (node.nextElementSibling?.textContent ?? '').trim(),
    );
    assert.equal(value, '1,000');
  });
});

describe('what it declines to match', () => {
  it('requires the whole label, not a fragment of a longer string', async () => {
    await page.setContent('<div>Tiền chuyển (Phí = 0) và một câu dài phía sau</div>');
    assert.equal(await page.locator('visibletext=Tiền chuyển (Phí = 0)').count(), 0);
  });

  it('returns the innermost match, not the wrapper around it', async () => {
    // Every ancestor whose extra content is only noise matches too. Handing
    // back the outermost would return a box covering half the screen.
    await page.setContent(`
      <div id="outer"><div id="middle"><span id="inner">Lệnh</span>
      <mat-icon class="mat-icon">refresh</mat-icon></div></div>
    `);
    const found = page.locator('visibletext=Lệnh');
    assert.equal(await found.count(), 1);
    assert.equal(await found.getAttribute('id'), 'inner');
  });

  it('strips an icon ligature before comparing', async () => {
    await page.setContent(
      '<div id="cap">Lệnh thường<mat-icon class="mat-icon">arrow_drop_down</mat-icon></div>',
    );
    assert.equal(await page.locator('visibletext=Lệnh thường').count(), 1);
  });

  it('ignores content hidden from assistive technology', async () => {
    await page.setContent(
      '<div id="cap">Lệnh<span aria-hidden="true"> (đã ẩn)</span></div>',
    );
    assert.equal(await page.locator('visibletext=Lệnh').count(), 1);
  });
});
