import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(await readFile(process.argv[2]!, 'utf8'), { waitUntil: 'domcontentloaded' });
// prose → CSS đã chuyển
const checks: Array<[string, string, string]> = [
  ['Chọn loại bảng giá',    'css', '[data-walkthrough="mb-header-segment"]'],
  ['Chứng quyền',           'css', '[data-walkthrough="mb-segment-cw"]'],
  ['Phái sinh',             'css', '[data-walkthrough="mb-derivative-tab"]'],
  ['Mở menu bảng giá',      'css', '[data-walkthrough="mb-header-menu"]'],
  ['Đóng bảng giá',         'css', '[data-walkthrough="mb-header-close"]'],
  ['Thanh tab sàn',         'css', '[data-walkthrough="mb-floor-tabs"]'],
  ['HOSE',                  'css', '[data-walkthrough="mb-floor-tab-hose"]'],
  ['Cơ sở',                 'css', '[data-walkthrough="mb-header-segment"] :text-is("Cơ sở")'],
  ['Cá nhân',               'css', '[data-walkthrough="mb-floor-tabs"] :text-is("Cá nhân")'],
  ['HNX',                   'css', '[data-walkthrough="mb-floor-tabs"] :text-is("HNX")'],
  ['UPCOM',                 'css', '[data-walkthrough="mb-floor-tabs"] :text-is("UPCOM")'],
  ['Ngành',                 'css', '[data-walkthrough="mb-floor-tabs"] :text-is("Ngành")'],
  ['cụm thao tác',          'css', '[data-walkthrough="mb-search-filter"]'],
  ['Thêm mã',               'css', '[data-walkthrough="mb-search-filter"] tcbs-icon[name="Circle add"]'],
  ['Tìm kiếm mã',           'css', '[data-walkthrough="mb-search-filter"] tcbs-icon[name="Search"]'],
  ['Bộ lọc thông minh',     'css', '[data-walkthrough="mb-search-filter"] tcbs-icon[name="Filter"]'],
  ['nút ⋯ trong dòng',      'css', '[data-walkthrough="mb-item-more"]'],
  ['Bảng portrait',         'css', 'app-tc-price .table-floor-container.mobile-view:not(.landscape)'],
  ['Footer',                'css', 'app-tc-price .mobile-footer app-footer-bar'],
  ['Footer · Đặt lệnh',     'css', 'app-tc-price .mobile-footer app-footer-bar .title:text-is("Đặt lệnh")'],
  ['Footer · Sổ lệnh',      'css', 'app-tc-price .mobile-footer app-footer-bar .title:text-is("Sổ lệnh")'],
  ['popup Danh mục',        'css', '.cat-menu-mb-popup'],
];
let ok = 0, zero = 0, many = 0;
for (const [name, , sel] of checks) {
  const n = await page.locator(sel).count().catch(() => -1);
  const mark = n === 1 ? '✓' : n === 0 ? '✗' : '•';
  if (n === 1) ok++; else if (n === 0) zero++; else many++;
  console.log(`  ${mark} ${String(n).padStart(3)}  ${name.padEnd(22)} ${sel.slice(0, 60)}`);
}
console.log(`\nduy nhất: ${ok}  |  không khớp: ${zero}  |  nhiều khớp: ${many}`);
await browser.close();
process.exit(0);
