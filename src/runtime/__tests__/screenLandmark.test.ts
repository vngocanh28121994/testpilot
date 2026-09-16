/**
 * Hai luật giữ cho "màn hình đã mở sẵn" là một kết luận có bằng chứng.
 *
 * Cả hai đều được viết như khẳng định trên mã nguồn, vì thứ cần canh ở đây là
 * một quyết định kiến trúc — dùng cái gì làm bằng chứng — chứ không phải một
 * giá trị trả về. Một lần "sửa cho gọn" ở hai chỗ này đã đủ để bốn kịch bản
 * chạy hết trên màn hình sai mà vẫn báo bước điều hướng PASS.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const resolver = readFileSync('src/runtime/resolver.ts', 'utf8');
const executor = readFileSync('src/runtime/executor.ts', 'utf8');

describe('bằng chứng màn hình đang mở', () => {
  /**
   * `isVisibleNow` thử MỌI locator của element, kể cả locator khớp chuỗi con.
   * Đó là đúng khi câu hỏi là "bấm được không", và là sai khi câu hỏi là "đang
   * ở màn nào" — nên landmark phải đi qua nhánh có lọc.
   *
   * Hai luật, không phải một. Luật chuỗi con được thêm sau sự cố "Bảng giá đã
   * mở sẵn" (15-09) và vẫn để lọt `role:dialog` — locator không nhắc tới nội
   * dung nào cả — nên hôm sau `transfer.thongBao` khớp một hộp thoại trên Home
   * và runner bỏ qua bước mở Search. Bỏ một trong hai là mở lại một trong hai
   * sự cố đó.
   */
  it('landmark chỉ nhận locator định danh chính xác', () => {
    const block = resolver.slice(resolver.indexOf('async visibleLandmarkOnScreen'));
    const body = block.slice(0, block.indexOf('\n  }'));
    assert.match(body, /visibleResolutionUsing\(/);
    assert.match(body, /!matchesByContainment\(c\)\s*&&\s*!matchesByShape\(c\)/);
    assert.doesNotMatch(body, /this\.isVisibleNow\(/);
  });

  /**
   * Ngăn kéo "Tìm tính năng" còn hiển thị thì ta vẫn đang ở chỗ xuất phát.
   *
   * Guard này từng hỏi pathname trước (`isHomeLikeRoute`), nên nó chỉ đúng với
   * bản web: trong WebView của bản hybrid, ngăn kéo là lớp phủ trên route đang
   * có và pathname không bao giờ là `/home`. Câu hỏi phải là về thứ đang hiển
   * thị, và phải được hỏi trước khi đụng tới URL.
   */
  it('ngăn kéo tìm tính năng được hỏi trước, không phụ thuộc đường dẫn', () => {
    const block = executor.slice(executor.indexOf('private async featureScreenLandmark'));
    const body = block.slice(0, block.indexOf('\n  }'));
    const drawer = body.indexOf("isVisibleNow('home.searchInput'");
    const route = body.indexOf('isHomeLikeRoute(');
    assert.ok(drawer > -1, 'guard ngăn kéo phải còn');
    assert.ok(route > -1, 'nhánh same-route vẫn giữ');
    assert.ok(drawer < route, 'ngăn kéo phải được hỏi TRƯỚC khi đọc URL');
    assert.match(
      body.slice(drawer, route),
      /if \(searchStillOpen\) return undefined;/,
      'ngăn kéo còn mở thì dừng ngay, không đi tiếp xuống nhánh landmark',
    );
  });
});
