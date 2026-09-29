import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slug } from '../pipeline.js';

describe('slug tên file feature', () => {
  it('giữ chữ "đ" thành "d" — không còn "ang-nhap"', () => {
    assert.equal(slug('Đăng nhập TCInvest'), 'dang-nhap-tcinvest');
    assert.equal(slug('Chuyển tiền đến tiểu khoản'), 'chuyen-tien-den-tieu-khoan');
  });
});
