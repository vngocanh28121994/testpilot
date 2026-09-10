/**
 * Định danh trong DOM phải khớp được với khoá của element.
 *
 * Luật cũ chỉ hỏi một chiều và chỉ so với NHÃN người đọc: `testId` phải chứa
 * nhãn. Nhãn viết tiếng Việt ("Ô tên đăng nhập"), app viết tiếng Anh
 * ("username") — nên lớp bằng chứng mạnh nhất bị bỏ qua hoàn toàn.
 *
 * Đo trên máy thật ngày 2026-09-10, hai ô cạnh nhau trên màn đăng nhập:
 *
 *            trước    sau
 *   ô tài khoản (đúng)   30      62
 *   ô mật khẩu  (sai)    30      30
 *
 * Trước khi sửa, bộ chấm KHÔNG phân biệt nổi hai ô — hoà điểm tuyệt đối, nên
 * hạ ngưỡng xuống là tung đồng xu giữa chúng.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { idOverlaps } from '../ConfidenceScorer.js';

describe('khớp định danh hai chiều', () => {
  it('khoá element chứa định danh DOM', () => {
    assert.equal(idOverlaps('username', 'usernameField'), true);
  });

  it('và chiều ngược lại cũng khớp', () => {
    assert.equal(idOverlaps('usernameFieldInput', 'usernameField'), true);
  });

  it('phân biệt được ô mật khẩu ngay cạnh', () => {
    assert.equal(idOverlaps('password', 'usernameField'), false);
  });

  /**
   * Không có ngưỡng độ dài thì "id", "el", "input" khớp với gần như mọi thứ —
   * và một tín hiệu khớp bừa còn tệ hơn không có tín hiệu, vì nó cộng điểm.
   */
  it('bỏ qua mẩu quá ngắn', () => {
    assert.equal(idOverlaps('id', 'usernameField'), false);
    assert.equal(idOverlaps('username', 'usr'), false);
  });
});
