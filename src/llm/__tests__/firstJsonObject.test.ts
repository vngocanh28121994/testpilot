/**
 * Ba chỗ trong genspec từng lấy từ dấu `{` ĐẦU TIÊN tới `}` CUỐI CÙNG. Cách đó
 * hỏng ngay khi model trả về hai đối tượng liền nhau — nó ôm trọn cả cụm, và
 * JSON.parse báo "Unexpected non-whitespace character after JSON at position
 * 2173", một câu không hề nói rằng vấn đề là CÓ HAI JSON chứ không phải JSON
 * hỏng. Đã làm chết một lượt workflow thật ở bước phân tích yêu cầu.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstJsonObject } from '../json.js';

describe('firstJsonObject', () => {
  it('lấy đúng đối tượng đầu tiên khi model trả về hai cái liền nhau', () => {
    const raw = '{"a":1}\n{"b":2}';
    assert.equal(firstJsonObject(raw), '{"a":1}');
    assert.deepEqual(JSON.parse(firstJsonObject(raw)), { a: 1 });
  });

  it('bỏ qua phần giải thích phía sau, kể cả khi nó có dấu ngoặc', () => {
    const raw = '{"a":1}\n\nLưu ý: dùng {placeholder} cho phần còn thiếu.';
    assert.deepEqual(JSON.parse(firstJsonObject(raw)), { a: 1 });
  });

  it('không nhầm dấu ngoặc nằm trong chuỗi là kết thúc', () => {
    const raw = '{"note":"đóng } ở đây không tính","b":2}';
    assert.deepEqual(JSON.parse(firstJsonObject(raw)), { note: 'đóng } ở đây không tính', b: 2 });
  });

  it('không nhầm dấu nháy đã escape', () => {
    const raw = String.raw`{"q":"anh ấy nói \"xong\"","b":2} thừa`;
    assert.deepEqual(JSON.parse(firstJsonObject(raw)), { q: 'anh ấy nói "xong"', b: 2 });
  });

  it('bỏ rào ```json mà model vẫn thêm dù đã yêu cầu JSON thuần', () => {
    assert.deepEqual(JSON.parse(firstJsonObject('```json\n{"a":1}\n```')), { a: 1 });
  });

  it('giữ nguyên object lồng nhau', () => {
    const raw = '{"a":{"b":{"c":1}}} rồi thừa';
    assert.deepEqual(JSON.parse(firstJsonObject(raw)), { a: { b: { c: 1 } } });
  });

  it('không có JSON thì nói không có', () => {
    assert.throws(() => firstJsonObject('xin lỗi, tôi không thể'), /không trả về JSON/);
  });

  it('ngoặc không khép thì nói thiếu dấu đóng', () => {
    assert.throws(() => firstJsonObject('{"a":1'), /thiếu dấu đóng/);
  });
});
