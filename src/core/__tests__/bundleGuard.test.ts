/**
 * Cổng đóng gói farm từng dừng cả lượt chạy vì "11/106 element không có locator".
 *
 * Đo lại thì cả hai vế đều sai:
 *   7/11 không kịch bản nào dùng tới — cổng quét TOÀN BỘ registry chứ không
 *     quét những element bộ test sắp chạy thật sự chạm vào, nên rác trong
 *     registry chặn được một lượt chạy hoàn toàn hợp lệ.
 *   4/11 có dùng, và đã chạy xanh nhiều lần — bằng discovery lúc chạy. Không có
 *     locator sẵn chỉ nghĩa là runtime sẽ đi tìm, đúng như trên máy local.
 *
 * Discovery và healing chạy trên farm y như dưới máy local, nên chặn ở đây là
 * chặn đúng cơ chế sinh ra để lo chuyện này.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const script = readFileSync('scripts/bundle-farm.sh', 'utf8');
/** Chỉ phần chương trình node nhúng trong script, nơi mọi cổng chặn nằm. */
const guard = script.slice(script.indexOf("node -e '"), script.indexOf("\n'", script.indexOf("node -e '")));

describe('cổng đóng gói farm', () => {
  it('chỉ xét element mà kịch bản có dùng', () => {
    assert.match(guard, /const used = \(e\) =>/);
    assert.match(guard, /return used\(e\);/);
  });

  it('thiếu locator thì cảnh báo, không dừng', () => {
    const warn = guard.slice(guard.indexOf('chưa có locator'));
    assert.match(warn.slice(0, 400), /console\.warn/);
    // Đoạn cảnh báo không được kết thúc bằng một cú process.exit.
    const untilNext = warn.slice(0, warn.indexOf('nameless'));
    assert.doesNotMatch(untilNext, /process\.exit/);
  });

  /**
   * Thứ THỰC SỰ chặn được: không locator mà cũng không tên gọi nghiệp vụ.
   * Discovery đi tìm bằng cái tên đó; thiếu cả tên thì nó không có gì để tìm.
   */
  it('vẫn dừng khi element không có cả tên lẫn locator', () => {
    assert.match(guard, /const nameless = naked\.filter\(\(e\) => !e\.label \|\| !e\.label\.trim\(\)\);/);
    const block = guard.slice(guard.indexOf('const nameless'));
    assert.match(block, /process\.exit\(1\)/);
  });

  /** Cắt danh sách ở 8 dòng giấu mất đúng những cái cuối cần sửa. */
  it('liệt kê đủ, không cắt bớt', () => {
    const warn = guard.slice(guard.indexOf('chưa có locator'), guard.indexOf('nameless'));
    assert.doesNotMatch(warn, /slice\(0, 8\)/);
  });
});
