/**
 * Luật popup của config, chạy trong WebView của iOS.
 *
 * Trước hôm nay `dismissOverlay()` trả `false` ngay cho mọi thứ không phải
 * Android, nên trên iOS không có gì đóng popup — mà đây đúng là hàm resolver
 * gọi khi locator bị che và executor gọi trước mỗi thao tác. Một modal bật lên
 * giữa kịch bản là bước đỏ với lý do "không tìm thấy element", trỏ vào locator
 * trong khi thứ hỏng nằm bên trên nó.
 *
 * Chỗ dễ hỏng nhất khi bê luật sang là `:has-text('x')`: cú pháp riêng của
 * Playwright, không phải CSS. Đưa thẳng vào `querySelector` là ném lỗi và luật
 * bị bỏ qua trong im lặng. Nên chạy trên DOM thật, đúng lối các test .dom khác.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { IOS_CONFIGURED_POPUP_SCRIPT } from '../native.js';

type Rule = { detect: string; dismiss: string };

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
after(async () => { await browser?.close(); });

async function runOn(html: string, rules: Rule[], protect: string[] = []) {
  await page.setContent(`<body>${html}</body>`);
  return page.evaluate(
    ([script, r, p]) =>
      (eval(script as string) as (a: unknown, b: unknown) => unknown)(r, p),
    [IOS_CONFIGURED_POPUP_SCRIPT, rules, protect] as const,
  ) as Promise<{ detect: string } | null>;
}

describe('luật popup cấu hình trên iOS', () => {
  it('đóng popup khớp selector CSS thường', async () => {
    const out = await runOn(
      `<div class="driver-popover"><button class="driver-popover-close-btn">x</button></div>`,
      [{ detect: '.driver-popover', dismiss: '.driver-popover .driver-popover-close-btn' }],
    );
    assert.deepEqual(out, { detect: '.driver-popover' });
  });

  it('hiểu :has-text — đúng cú pháp đang nằm trong config thật', async () => {
    const out = await runOn(
      `<div><button>ĐỒNG Ý</button><button>TỪ CHỐI</button></div>`,
      [{ detect: "button:has-text('TỪ CHỐI')", dismiss: "button:has-text('TỪ CHỐI')" }],
    );
    assert.deepEqual(out, { detect: "button:has-text('TỪ CHỐI')" });
  });

  it('không có popup thì không bịa ra hành động', async () => {
    assert.equal(
      await runOn('<div>trang bình thường</div>', [{ detect: '.driver-popover', dismiss: 'button' }]),
      null,
    );
  });

  /**
   * Kịch bản có thể đang KIỂM CHỨNG chính hộp thoại đó. Đóng nó là xoá mất bằng
   * chứng và biến một bước đúng thành một bước không kết luận được.
   */
  it('chừa lại thứ kịch bản đang bảo vệ', async () => {
    const out = await runOn(
      `<div class="driver-popover"><button class="driver-popover-close-btn">x</button></div>`,
      [{ detect: '.driver-popover', dismiss: '.driver-popover .driver-popover-close-btn' }],
      ['.driver-popover'],
    );
    assert.equal(out, null);
  });
});
