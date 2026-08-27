/**
 * What a step means when it names a field by the caption printed next to it.
 *
 * A tester writes `I enter "100" into "KL đặt"` because "KL đặt" is what the
 * screen says. The markup underneath puts that text in a `<legend>`, a
 * `<label>`, or an `aria-labelledby` target — never in the input itself. Every
 * case below is a real association HTML defines; getting any of them wrong
 * means typing into a caption, which is how a step passed while the field it
 * was supposed to fill stayed at 0.
 */
import { toneMarkVariants } from '../../core/text.js';
import { labelXPaths, labelXPathsBySpelling } from '../../core/labelXPath.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { domSelector } from '../native.js';
import { labelContainsXPath } from '../../core/labelXPath.js';

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
after(async () => { await browser?.close(); });

const label = (value: string) =>
  domSelector({ strategy: 'label', value, weight: 1, origin: 'authored' });

/** What the label resolves to: tag name plus whatever identifies it. */
async function resolve(markup: string, text: string): Promise<string> {
  // Wrapped in other content on purpose. On a page holding nothing but the
  // label, <html>'s own string-value equals that label and the container
  // matches first — an artefact of an empty fixture, not of a real screen.
  await page.setContent(
    `<!doctype html><body><h1>Đặt lệnh</h1>${markup}<footer>Bảng giá</footer></body>`,
  );
  const first = page.locator(label(text)).first();
  if ((await first.count()) === 0) return '(không khớp gì)';
  return first.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const id = (el as HTMLInputElement).name || el.id || '';
    return id ? `${tag}[${id}]` : tag;
  });
}

describe('domSelector — nhãn trỏ tới ô nhập liệu', () => {
  it('fieldset + legend: takes the control, not the caption', async () => {
    // Copied from the TCInvest order form.
    assert.equal(
      await resolve(
        `<fieldset class="volume"><legend><div> KL đặt </div></legend>
           <button>-</button><input name="volume" placeholder="0"><button>+</button>
         </fieldset>`,
        'KL đặt',
      ),
      'input[volume]',
    );
  });

  it('label[for]', async () => {
    assert.equal(
      await resolve('<label for="px">Giá đặt</label><input id="px" name="price">', 'Giá đặt'),
      'input[price]',
    );
  });

  it('label wrapping the control', async () => {
    assert.equal(
      await resolve('<label>Giá đặt<input name="price"></label>', 'Giá đặt'),
      'input[price]',
    );
  });

  it('aria-labelledby', async () => {
    assert.equal(
      await resolve('<span id="lb">KL đặt</span><input aria-labelledby="lb" name="volume">', 'KL đặt'),
      'input[volume]',
    );
  });

  it('case and diacritics do not matter', async () => {
    const markup = '<button class="btn-buy"><span> Lưu Mua </span></button>';
    for (const written of ['Lưu mua', 'Lưu Mua', 'LƯU MUA']) {
      assert.equal(await resolve(markup, written), 'button', `viết "${written}"`);
    }
  });

  it('ignores a Material icon ligature sitting next to the text', async () => {
    // <mat-icon>arrow_drop_down</mat-icon> contributes its ligature name to the
    // container's string-value, so "Lệnh thường" was unreachable — on web and
    // in the WebView alike.
    assert.equal(
      await resolve(
        `<div id="ord" class="flex items-center"> Lệnh thường
           <mat-icon aria-hidden="true">arrow_drop_down</mat-icon>
           <div class="t-masker"></div>
         </div>`,
        'Lệnh thường',
      ),
      'div[ord]',
    );
  });

  it('plain text is still matched on its own element', async () => {
    // The exclusion must not swallow ordinary assertions.
    assert.equal(await resolve('<div id="t">Tổng tài sản</div>', 'Tổng tài sản'), 'div[t]');
  });

  it('a caption that labels nothing still matches itself', async () => {
    const got = await resolve('<fieldset><legend>Ghi chú</legend></fieldset>', 'Ghi chú');
    assert.ok(['legend', 'fieldset'].includes(got), `khớp vào ${got}`);
  });
});
describe('domSelector — thông báo mang dữ liệu bên trong', () => {
  const TOAST = `<div class="toast"><span id="msg">Đã lưu lệnh Mua TCB 28000 x 100 = 2,800,000 vào Sổ lệnh chờ gửi</span></div>`;

  const loose = async (markup: string, text: string): Promise<string> => {
    const xp = labelContainsXPath(text);
    if (!xp) return '(nhãn quá ngắn — không có lượt gần khớp)';
    await page.setContent(`<!doctype html><body><h1>Đặt lệnh</h1>${markup}</body>`);
    const first = page.locator(`xpath=${xp}`).first();
    if ((await first.count()) === 0) return '(không khớp gì)';
    return first.evaluate((el) => el.tagName.toLowerCase() + (el.id ? `[${el.id}]` : ''));
  };

  it('finds the element that renders the message', async () => {
    assert.equal(await loose(TOAST, 'Đã lưu lệnh Mua'), 'span[msg]');
  });

  it('matches wording from the middle, not only the opening', async () => {
    // The fixed part of a template is not always at the front.
    assert.equal(await loose(TOAST, 'vào Sổ lệnh chờ gửi'), 'span[msg]');
  });

  it('takes the element holding the words, never a wrapper around it', async () => {
    // string(.) would match .toast, body and html as well, and document order
    // hands the widest one to .first() — a click would land on the whole page.
    const got = await loose(TOAST, 'Đã lưu lệnh Mua');
    assert.equal(got, 'span[msg]', 'phải là phần tử chứa chữ, không phải khung bọc');
  });

  it('refuses a label too short to be deliberate', async () => {
    // "Đóng" inside "Đã đóng lệnh thành công" is a coincidence.
    assert.equal(labelContainsXPath('Đóng'), undefined);
    assert.equal(labelContainsXPath('Lưu mua'), undefined);
    assert.ok(labelContainsXPath('Đã lưu lệnh mua'));
  });
});

describe('tone-mark spelling variants', () => {
  it('offers one arm list per spelling, not one union of both', () => {
    // Unioning the spellings was correct and unusable: nine arms per spelling
    // cost ~350ms on a real page, the union cost 651ms, and the driver gives a
    // locator 250ms to attach. The query matched and nothing waited to hear it.
    const lists = labelXPathsBySpelling('Xoá khỏi danh mục');
    assert.equal(lists.length, 2, 'hai lối viết, hai lần thử riêng');
    assert.equal(lists[0]!.length, labelXPaths('Xoá khỏi danh mục').length,
      'mỗi lần thử vẫn đúng chi phí của một lối viết');
  });

  it('finds a control the app spells the other correct way', async () => {
    await page.setContent(
      '<!doctype html><body><div role="menu"><span>Xóa khỏi danh mục</span></div></body>',
    );
    // The scenario says "Xoá"; the page says "Xóa". Some spelling has to match.
    let found = 0;
    for (const arms of labelXPathsBySpelling('Xoá khỏi danh mục')) {
      found += await page.locator(`xpath=${arms.join(' | ')}`).count();
    }
    assert.ok(found > 0, 'phải tìm được dù kịch bản viết lối kia');
  });

  it('leaves a label with no such cluster alone', () => {
    assert.deepEqual(toneMarkVariants('Thêm mã'), ['Thêm mã']);
    assert.equal(labelXPathsBySpelling('Thêm mã').length, 1, 'không sinh lần thử thừa');
  });

  it('covers capitalised clusters', () => {
    assert.deepEqual(toneMarkVariants('Uỷ quyền'), ['Uỷ quyền', 'Ủy quyền']);
  });
});
