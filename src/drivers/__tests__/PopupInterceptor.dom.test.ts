/**
 * The dismissal script, run against a real DOM.
 *
 * The sibling unit test stubs `page.evaluate`, so it can prove the *loop* is
 * right and nothing about the script inside the page — which is where the
 * decisions actually live. Coach marks cost an afternoon of intermittent,
 * different-step-every-run failures precisely there: the markup below is copied
 * from a captured TCInvest DOM, arrow z-index included.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { PopupInterceptor } from '../PopupInterceptor.js';

/** A bubble at 10000 over a click-swallowing backdrop, with an arrow at 10001. */
const COACH_MARK = `
  <button id="beneath" onclick="window.__hit = true">Lệnh thường</button>
  <div class="draggable-guide-overlay"
       style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;pointer-events:auto"></div>
  <div class="draggable-guide-tooltip" style="position:fixed;top:80px;left:10px;z-index:10000">
    <div class="tooltip-text">Giữ nút để di chuyển đến vị trí khác</div>
    <button class="tooltip-button btn-primary"
      onclick="document.querySelectorAll('[class*=draggable-guide]').forEach(n => n.remove())">Đã hiểu</button>
  </div>
  <div class="draggable-guide-arrow"
       style="position:fixed;top:60px;left:20px;width:16px;height:16px;z-index:10001"></div>`;

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
after(async () => { await browser?.close(); });

const show = (body: string) => page.setContent(`<!doctype html><body>${body}</body>`);

describe('PopupInterceptor in a real page', () => {
  it('dismisses a coach mark whose top layer is a decoration', async () => {
    await show(COACH_MARK);
    const log: string[] = [];
    const dismissed = await new PopupInterceptor([], (m) => log.push(m)).clear(page);

    assert.equal(dismissed, 1);
    assert.match(log.join(' '), /ĐÃ HIỂU/);
    // The backdrop goes with it; a bubble dismissed while its backdrop survives
    // would leave every later tap blocked with nothing left to close.
    assert.equal(await page.locator('.draggable-guide-overlay').count(), 0);

    await page.locator('#beneath').click({ timeout: 2000 });
    assert.equal(await page.evaluate(() => (window as unknown as { __hit?: boolean }).__hit), true);
  });

  it('leaves the layer holding the wanted element alone', async () => {
    await show(`
      <div role="dialog" style="position:fixed;inset:20px;z-index:50;background:#fff">
        <p>Lưu lệnh</p>
        <button>Đóng</button>
      </div>`);
    const dismissed = await new PopupInterceptor([], () => {}).clear(page, ['text=Lưu lệnh']);
    assert.equal(dismissed, 0, 'protected layer must survive');
  });

  it('never clicks through a dialog that has no safe control', async () => {
    // The lower dialog's "Đóng" is reachable in the DOM but covered on screen.
    // Descending past the upper dialog would click it, dismissing a layer the
    // user cannot even see — the failure mode the top-layer rule exists to stop.
    await show(`
      <div role="dialog" style="position:fixed;inset:40px;z-index:10">
        <button>Đóng</button>
      </div>
      <div role="dialog" style="position:fixed;inset:0;z-index:900;background:#fff">
        <button>Xác nhận chuyển tiền</button>
      </div>`);
    const dismissed = await new PopupInterceptor([], () => {}).clear(page);
    assert.equal(dismissed, 0, 'a dialog with only unsafe controls must stop the search');
  });

  it('protects a message layer named by part of its text', async () => {
    // The toast the step is waiting for carries data the step cannot state, and
    // its ✕ is a safe control — so without a partial-text guard the dismisser
    // closed the very thing being asserted on.
    await show(`
      <div class="cdk-overlay-pane" style="position:fixed;bottom:10px;z-index:900">
        <span>Đã lưu lệnh Mua TCB 28000 x 100 = 2,800,000 vào Sổ lệnh chờ gửi</span>
        <button aria-label="close" onclick="this.parentElement.remove()">✕</button>
      </div>`);
    const dismissed = await new PopupInterceptor([], () => {}).clear(page, ['text=Đã lưu lệnh Mua']);
    assert.equal(dismissed, 0, 'toast đang được chờ thì không được đóng');
  });

  it('still closes a message layer nobody is waiting for', async () => {
    await show(`
      <div class="cdk-overlay-pane" style="position:fixed;bottom:10px;z-index:900">
        <span>Đã lưu lệnh Mua TCB 28000 x 100 = 2,800,000 vào Sổ lệnh chờ gửi</span>
        <button aria-label="close" onclick="this.parentElement.remove()">✕</button>
      </div>`);
    const dismissed = await new PopupInterceptor([], () => {}).clear(page, ['text=Tổng tài sản']);
    assert.equal(dismissed, 1);
  });

  it('ignores ordinary tooltips, which are not blocking layers', async () => {
    // 387 nodes in one captured screen carry a `tooltip` class. Widening the
    // root list by that word would make the interceptor click into the app.
    await show(`
      <div class="mat-tooltip-trigger tooltip-box-popup"><button>Đóng</button></div>
      <span class="fund-item-tooltip-info">Lãi suất</span>`);
    const dismissed = await new PopupInterceptor([], () => {}).clear(page);
    assert.equal(dismissed, 0);
  });
});
