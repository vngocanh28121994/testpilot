/**
 * Danh sách "chưa duyệt" phải nói về LƯỢT CHẠY NÀY.
 *
 * Người dùng chọn tag đăng nhập và nền tảng iOS, rồi nhận về mười ba dòng về
 * những feature hoàn toàn khác — thêm mã cổ phiếu, chuyển tiền, tooltip — kèm
 * câu "13 kịch bản chưa duyệt nên không được chạy". Đọc như thể lượt chạy vừa
 * bị chặn, trong khi nó chạy bình thường và mười ba kịch bản kia chưa bao giờ
 * nằm trong phạm vi được hỏi.
 *
 * Gốc: danh sách gom từ MỌI feature, không lọc theo tag lẫn nền tảng.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync('src/cli/run.ts', 'utf8');

describe('phạm vi của danh sách chưa duyệt', () => {
  it('lọc theo cùng điều kiện với lượt chạy', () => {
    assert.match(source, /\.flatMap\(\(feature\) => feature\.unapproved\)\s*\n\s*\.filter\(inScope\)/);
  });

  /**
   * Một predicate duy nhất cho câu hỏi "kịch bản này có thuộc lượt chạy không".
   * Hai định nghĩa là hai cách trôi khỏi nhau — và lần trôi vừa rồi khiến người
   * dùng đọc một câu cảnh báo về việc họ không hề yêu cầu.
   */
  it('vòng chạy dùng lại đúng predicate đó', () => {
    assert.match(source, /if \(!inScope\(scenario\)\) continue;/);
    // Luật thật sống trong core/tagScope; run.ts chỉ được gọi nó, không chép
    // lại phép kiểm tra platform tại chỗ.
    assert.doesNotMatch(source, /scenario\.platforms\.includes\(platform\)/);
  });

  it('giữ nguyên kịch bản chứ không chỉ tên', () => {
    assert.match(
      source,
      /const unapproved = feature\.scenarios\.filter\(\(scenario\) => !approvedNames\.has\(scenario\.name\)\);/,
      'chỉ giữ tên thì không lọc được theo tag và nền tảng',
    );
  });

  it('lưu lượt chưa duyệt là incomplete/failed, không phải passed 0/0', () => {
    assert.match(source, /realFailures\.length > 0 \|\| unapproved\.length > 0 \? 'failed' : 'passed'/);
    assert.match(source, /total: results\.length \+ quarantined\.length \+ unapproved\.length/);
  });
});
