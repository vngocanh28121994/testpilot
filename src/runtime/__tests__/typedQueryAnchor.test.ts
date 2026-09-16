/**
 * Cú bấm ngay sau một lần gõ phải trúng thứ phản ánh chữ vừa gõ.
 *
 * Panel của autocomplete đổi SAU chữ gõ vào, không đổi cùng lúc. Trong khoảng
 * trễ ấy, lựa chọn còn sót lại từ truy vấn trước vẫn nằm đó và vẫn bấm được —
 * mà locator "kết quả tìm kiếm đầu tiên" thì khớp mọi lựa chọn trong panel,
 * nên nó không phân biệt được.
 *
 * Đo trên máy thật ngày 2026-09-16: kịch bản gõ "VIC", bấm kết quả đầu tiên,
 * và thêm mã EVS vào danh mục (53 dòng → 54, EVS chen lên vị trí 0). Lỗi sống
 * được lâu vì assertion kiểm "dòng đầu là VIC" mà VIC vốn đã nằm sẵn ở đầu —
 * hai lượt chạy có log giống nhau từng chữ, một xanh một đỏ, và lượt xanh
 * xanh vì lý do sai.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const executor = readFileSync('src/runtime/executor.ts', 'utf8');
const cdp = readFileSync('src/drivers/WebViewCdpDriver.ts', 'utf8');

const method = (() => {
  const from = executor.indexOf('private async anchorToTypedQuery');
  return executor.slice(from, executor.indexOf('\n  }', from));
})();

describe('neo cú bấm vào chữ vừa gõ', () => {
  it('cú bấm dùng handle đã neo, không dùng handle thô', () => {
    assert.match(executor, /const anchored = await this\.anchorToTypedQuery\(/);
    assert.match(executor, /await this\.driver\.tap\(anchored\)/);
    assert.doesNotMatch(executor, /await this\.driver\.tap\(r\.handle\)/);
  });

  /**
   * Hai điều kiện, và thiếu cái nào cũng thành chặn oan: một nút "Lưu" khớp
   * đúng một phần tử thì chữ vừa gõ không liên quan gì tới nó.
   */
  it('chỉ neo khi locator khớp nhiều phần tử và vừa có chữ được gõ', () => {
    assert.match(method, /if \(!query \|\| !matches \|\| matches\.count <= 1\) return resolution\.handle;/);
  });

  /**
   * Không thấy kết quả phản ánh truy vấn thì CHỜ. Bấm trong lúc panel chưa kịp
   * đổi chính là lỗi đang sửa, nên đường thoát duy nhất là hết giờ rồi hỏng.
   */
  it('chưa thấy thì chờ rồi hỏng có địa chỉ, không bấm đại', () => {
    assert.match(method, /đang chờ kết quả phản ánh/);
    assert.match(method, /while \(Date\.now\(\) < deadline\)/);
    assert.match(method, /Không bấm[\s\S]{0,120}Đang hiển thị/);
  });

  /**
   * Chữ vừa gõ sống đúng một bước. Ranh giới đó phải nằm ở execute(), không ở
   * từng lần thử lại trong một bước — bước hỏng rồi thử lại vẫn là cùng cú
   * bấm, nên nó phải được neo y như lần đầu.
   */
  /**
   * Và chỉ bước NGOÀI CÙNG mới đặt được nó. Một bước phức hợp tự gõ bên trong
   * — `openFeatureFromSearch` gõ tên tính năng rồi tự chọn kết quả — đã xong
   * việc của nó; để chữ ấy rò ra thì bước kế tiếp bị neo vào một truy vấn
   * chẳng liên quan. Lượt chạy thật đã in đúng như vậy:
   * `"Nút tùy chọn dòng": đang chờ kết quả phản ánh "Bảng giá cổ phiếu"`.
   */
  it('chữ vừa gõ hết hiệu lực sau đúng một bước, và chỉ bước ngoài cùng đặt được', () => {
    assert.match(executor, /if \(this\.executeDepth === 1\) this\.typedQuery = text\.trim\(\) \|\| undefined;/);
    assert.match(executor, /if \(this\.executeDepth === 1\) this\.typedQuery = undefined;/);
  });

  /**
   * Handle của CDP tự dựng lại locator từ `selector` mỗi lần được hỏi, nên một
   * bộ lọc chỉ đặt trên biến cục bộ sẽ biến mất ngay sau khi find() trả về.
   */
  it('điều kiện chữ sống sót trên handle, không chỉ trong find()', () => {
    assert.match(cdp, /locator = locator\.filter\(\{ hasText: candidate\.runtimeText \}\)/);
    assert.match(cdp, /if \(candidate\.runtimeText && !directLocator\) directLocator = locator\.first\(\);/);
  });

  /** `runtimeText` là điều kiện của lúc chạy, không được rơi vào registry. */
  it('không lưu điều kiện lúc chạy vào registry', () => {
    const resolver = readFileSync('src/runtime/resolver.ts', 'utf8');
    assert.match(resolver, /runtimeText: _runtimeText,/);
  });
});
