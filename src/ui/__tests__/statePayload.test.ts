/**
 * /api/state được gọi lại sau MỖI thao tác trên trang, nên mọi thứ nằm trong đó
 * đều bị trả giá liên tục — kể cả thứ không ai đọc.
 *
 * `stepTexts` là một thứ như vậy: server duyệt mọi bước của mọi kịch bản để
 * dựng nó, gửi kèm 11 KB trên tổng 71 KB, và không một dòng mã giao diện nào
 * đọc tới. Bảng Kịch bản chỉ hiện SỐ bước; nội dung các bước lấy từ chính khối
 * Gherkin khi mở ra sửa.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const server = readFileSync('src/ui/server.ts', 'utf8');
const contracts = readFileSync('src/ui/contracts.ts', 'utf8');

describe('/api/state không mang theo thứ không ai đọc', () => {
  it('không dựng stepTexts nữa', () => {
    assert.doesNotMatch(server, /stepTexts/, 'stepTexts đã quay lại trong payload state');
    assert.doesNotMatch(contracts, /stepTexts/, 'stepTexts đã quay lại trong contract');
  });

  /**
   * Log từng nằm trong cùng payload đó vì cùng một lý do — có sẵn thì gửi luôn.
   * Giữ hai điều kiện này cạnh nhau để lần sau ai đó thêm một trường "tiện thể"
   * thì có chỗ đọc lại vì sao không nên.
   */
  it('chỉ nói có log hay không, không gửi nội dung', () => {
    assert.match(server, /const hasLog = existsSync/);
    assert.match(contracts, /hasLog: boolean;/);
  });

  it('danh sách lượt chạy có giới hạn', () => {
    assert.match(server, /const MAX_REPORTS = 50;/);
    assert.match(server, /\.slice\(0, MAX_REPORTS\)/);
  });
});
