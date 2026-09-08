/**
 * `known` từng được khai báo GIỮA hai chỗ dùng nó.
 *
 * TypeScript không bắt được: chỗ dùng đầu tiên nằm trong callback của `.map()`,
 * mà trình biên dịch không chứng minh được callback chạy lúc nào nên nó im
 * lặng. Test cũng không bắt được, vì không test nào chạy tới bước ghi report.
 *
 * Nên nó chỉ lộ ra khi chạy thật, và lộ theo cách đắt nhất có thể: 8 kịch bản
 * chạy xong xuôi rồi cả bước ghi report chết bằng "Cannot access 'known' before
 * initialization" — mất sạch report của một lượt chạy 6 phút trên môi trường
 * thật, trong khi mọi kết quả đều đã có trong tay.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/cli/run.ts', 'utf8');

describe('run.ts — known issue store', () => {
  it('được nạp trước mọi chỗ dùng', () => {
    const declared = source.indexOf('const known = await KnownIssueStore.load');
    assert.notEqual(declared, -1, 'không còn nạp KnownIssueStore nữa?');

    // Chỉ soi phần trước dòng khai báo: ở đó không được có lời gọi nào lên nó.
    const before = source.slice(0, declared);
    for (const call of ['known.active(', 'known.stale(', 'knownById']) {
      assert.ok(
        !before.includes(call),
        `${call} xuất hiện TRƯỚC khi known được nạp — đúng lỗi đã làm chết bước ghi report`,
      );
    }
  });
});
