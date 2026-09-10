/**
 * Không để log tiếng Anh của thư viện lọt ra màn hình người dùng.
 *
 * Lượt chạy 08:44 ngày 2026-09-10 xanh cả hai kịch bản, nhưng trong log vẫn có:
 *
 *   ERROR webdriver: WebDriverError: An attempt was made to operate on a modal
 *   dialog when one was not open when running "execute/sync"
 *
 * Dòng đó do WebdriverIO tự ghi ra stderr TRƯỚC khi promise reject, nên một lỗi
 * mà tool đã bắt và xử lý xong vẫn để lại vết. Một lượt chạy đạt mà log đầy chữ
 * ERROR thì người đọc không còn phân biệt được cái nào đáng lo.
 *
 * Hai lớp chặn, và cần cả hai: bỏ hẳn tiếng nói của thư viện, và đừng cố tình
 * gây ra lỗi để dùng nó làm luồng điều khiển.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/drivers/native.ts', 'utf8');

describe('log sạch', () => {
  it('WebdriverIO không tự ghi log nữa', () => {
    assert.match(source, /logLevel: 'silent',/);
    assert.doesNotMatch(source, /logLevel: 'error',/);
  });

  /**
   * Cách cũ hỏi `mobile: alert` rồi bắt lỗi làm điều kiện dừng. Đúng logic,
   * nhưng mỗi lần mở app là một dòng ERROR — kể cả khi không có hộp thoại nào,
   * tức là trường hợp bình thường nhất.
   */
  it('dò hộp thoại bằng tìm element, không bằng cách gây lỗi', () => {
    const loop = source.slice(source.indexOf('private async clearIosAlerts'));
    // Cắt tại LỆNH GỌI, không phải tại chữ "mobile: alert" đầu tiên — chuỗi đó
    // cũng nằm trong câu chú thích ngay phía trên, và cắt nhầm ở đó thì test
    // soi vào một đoạn rỗng rồi báo đỏ một thay đổi hoàn toàn đúng.
    const head = loop.slice(0, loop.indexOf(`execute('mobile: alert'`));
    assert.match(head, /XCUIElementTypeAlert/);
    assert.match(head, /alerts\.length === 0/);
  });
});
