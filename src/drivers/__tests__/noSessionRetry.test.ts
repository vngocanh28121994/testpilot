/**
 * Một phiên iOS hỏng thì hỏng luôn, không thử lại.
 *
 * WebdriverIO mặc định thử lại một request hỏng 3 lần. Với POST /session trên
 * iOS, mỗi lần thử là: gỡ app, cài lại bản ipa hơn 100 MB (~34 giây trên máy
 * thật), rồi build và cài WebDriverAgent. Đo trong log Appium ngày 2026-09-10:
 * ba lượt cài app-sit.ipa liên tiếp cho cùng MỘT lượt chạy, tất cả đều chết ở
 * cùng một lỗi "Developer App Certificate is not trusted".
 *
 * Những lỗi hay gặp ở bước này đều tất định — chứng chỉ chưa tin cậy, thiếu
 * teamId, sai bundle id — nên lần thử thứ hai không mang lại thông tin mới, chỉ
 * mang lại mười phút và một màn hình trông như đang kẹt vòng lặp. Người dùng đã
 * hai lần báo đúng triệu chứng đó, và cả hai lần đều mất công truy mới ra.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/drivers/native.ts', 'utf8');

describe('phiên iOS hỏng thì dừng ngay', () => {
  it('tắt cơ chế thử lại của WebdriverIO cho iOS', () => {
    assert.match(source, /isAndroid \? \{\} : \{ connectionRetryCount: 0 \}/);
  });

  it('Android vẫn giữ mặc định — phiên ở đó không cài lại gì', () => {
    const line = /\.\.\.\(isAndroid \? \{\} : \{ connectionRetryCount: 0 \}\),/.exec(source);
    assert.ok(line, 'không thấy cấu hình retry');
    // Không có nhánh nào đặt connectionRetryCount cho Android.
    assert.equal(source.match(/connectionRetryCount/g)?.length, 1);
  });
});
