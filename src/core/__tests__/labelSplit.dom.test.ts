/**
 * A caption the template split across several elements.
 *
 * Angular renders `Tiền chuyển (Phí = {{fee}})` as two spans — `Tiền chuyển
 * (Phí = ` and `0)` — so the phrase a scenario writes is on screen but in no
 * single element. Every exact arm matches nothing, and the existing loose arm
 * cannot help either: it reads `text()`, the element's own text nodes, which is
 * exactly what the split destroyed.
 *
 * Three scenarios failed this way on the mobile build of a screen the desktop
 * build resolves fifteen times out of fifteen. The markup below is copied from
 * the page dump of that run, tooltip included — the tooltip is why a plain
 * "cleaned text equals" rule has to strip anything before comparing, and why
 * this arm compares with `contains` and narrows by depth instead.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';

import { labelContainsXPath, labelSplitAcrossChildrenXPath } from '../labelXPath.js';

let browser: Browser;
let page: Page;

/** The real transfer-confirmation row, as the phone rendered it. */
const SPLIT_CAPTION = `
  <div class="row pull-left p-b-24">
    <div class="row" id="target">
      <span class="body2">Tiền chuyển (Phí = </span><span class="body2">0)</span>
      <div class="tooltip title-tooltip-content">
        <div>Phí chuyển tiền là phí do ngân hàng quy định, TCBS là đơn vị thu hộ</div>
      </div>
    </div>
    <div class="row p-t-4"><span>1,000</span></div>
  </div>
`;

const count = (xpath: string | undefined): Promise<number> =>
  xpath ? page.locator(`xpath=${xpath}`).count() : Promise.resolve(-1);

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => { await browser?.close(); });

describe('a caption split across children', () => {
  it('is missed by the loose arm, which reads own text only', async () => {
    await page.setContent(SPLIT_CAPTION);
    // Not a quirk to work around later — this is the reason the new arm exists,
    // and it is asserted so nobody "simplifies" the two into one.
    assert.equal(await count(labelContainsXPath('Tiền chuyển (Phí = 0)')), 0);
  });

  it('is found by the split arm, in the element that renders it', async () => {
    await page.setContent(SPLIT_CAPTION);
    const xpath = labelSplitAcrossChildrenXPath('Tiền chuyển (Phí = 0)');
    assert.equal(await count(xpath), 1);
    const tag = await page.locator(`xpath=${xpath}`).evaluate((n) => (n as Element).id);
    assert.equal(tag, 'target');
  });

  it('picks the smallest element holding the phrase, not every ancestor', async () => {
    await page.setContent(SPLIT_CAPTION);
    // A plain contains(.) matched thirty-one elements on the real page — every
    // ancestor up to <html> — which is why depth, not breadth, does the work.
    const plain = `//*[contains(normalize-space(.), 'Tiền chuyển (Phí = 0)')]`;
    assert.ok(await count(plain) > 1);
    assert.equal(await count(labelSplitAcrossChildrenXPath('Tiền chuyển (Phí = 0)')), 1);
  });

  it('ignores case, as the other arms do', async () => {
    await page.setContent(SPLIT_CAPTION);
    assert.equal(await count(labelSplitAcrossChildrenXPath('TIỀN CHUYỂN (PHÍ = 0)')), 1);
  });

  it('refuses a single word, where a substring match is a hazard', async () => {
    // "OK" is inside "BOOK", and the deepest-element rule would return the
    // element rendering the wrong word with full confidence.
    assert.equal(labelSplitAcrossChildrenXPath('OK'), undefined);
    assert.equal(labelSplitAcrossChildrenXPath('  Đóng  '), undefined);
  });

  it('still matches when the caption is not split at all', async () => {
    // The arm must not be special-cased to split markup: the same phrase in one
    // element is the smallest element containing it.
    await page.setContent(`<div><span id="only">Tiền chuyển (Phí = 0)</span></div>`);
    const xpath = labelSplitAcrossChildrenXPath('Tiền chuyển (Phí = 0)');
    assert.equal(await count(xpath), 1);
    assert.equal(await page.locator(`xpath=${xpath}`).evaluate((n) => (n as Element).id), 'only');
  });
});
