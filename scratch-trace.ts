import { selectors } from 'playwright';
import { createPomPageContext } from './src/pom/context.js';
import { VISIBLE_TEXT_ENGINE } from './src/drivers/web.js';

process.env.TESTPILOT_ENV = 'prod';
process.env.TESTPILOT_DEVICE = 'sm-s938b';

await selectors.register('visibletext', { content: VISIBLE_TEXT_ENGINE }).catch(() => {});

const page = await createPomPageContext({ defaultPlatform: 'android' });
const drv = (page as any).driver;

try {
  await page.launch();
  await page.ensureLoggedIn('tcbs');
  await page.openFeatureFromSearch('Chuyển tiền');
  await page.select('transfer.sourceAccount', 'TK Thường');
  await page.select('transfer.chonTkNhanTien', 'TK Ký Quỹ');
  await page.input('transfer.soTien', '1,000');
  await page.tap('transfer.submitButton');
  await new Promise((r) => setTimeout(r, 2500));

  const p = drv.cdpDriver.page;
  const want = 'Tiền chuyển (Phí = 0)';
  console.log('\ntrên màn xác nhận:');
  const deepest = await p.evaluate((w) => {
    const hits = [...document.querySelectorAll('*')].filter((el) => {
      const copy = el.cloneNode(true) as Element;
      copy.querySelectorAll('mat-icon,.tooltip,[class*="tooltip"],[aria-hidden="true"],script,style')
        .forEach((n) => n.remove());
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim() === w;
    });
    return hits.map((el) => el.tagName + '.' + String(el.className).split(' ')[0]);
  }, want);
  console.log('  văn bản-đã-làm-sạch bằng đúng nhãn →', JSON.stringify(deepest));
  const deepestXp = `//*[contains(normalize-space(.), ${JSON.stringify(want)}) and not(.//*[contains(normalize-space(.), ${JSON.stringify(want)})])]`;
  const dl = p.locator(`xpath=${deepestXp}`);
  console.log('  xpath sâu-nhất    →', await dl.count(),
    JSON.stringify(await dl.first().evaluate((n: Element) => n.tagName + '.' + String(n.className).split(' ')[0]).catch(() => null)));
  console.log('  xpath contains    →', await p.locator(`xpath=//*[contains(normalize-space(.),'${want}')]`).count());
  const h = await drv.find({ strategy: 'label', value: want, weight: 1, origin: 'authored' });
  console.log('  driver.find()     →', h ? 'CÓ' : 'null');
} catch (e) {
  console.log('LỖI:', (e as Error).message.split('\n').slice(0, 3).join('\n'));
} finally {
  await (page as any).close?.().catch?.(() => {});
  process.exit(0);
}
