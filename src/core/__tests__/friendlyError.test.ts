/**
 * Câu lỗi người dùng thật đã gặp, và câu họ phải thấy thay vào đó.
 *
 * Ba điều phải giữ: nói việc cần làm, giữ nguyên văn cho người đi đào lỗi, và
 * KHÔNG động vào câu đã tốt — một câu tiếng Việt do TestPilot viết không được
 * dài thêm vì bị bọc một lớp nữa.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { friendlyError, friendlyStatus } from '../friendlyError.js';

describe('friendlyError — lỗi thật đã gặp', () => {
  it('cổng MJPEG của phiên đã chết (2026-09-24, màn Điều khiển)', () => {
    const raw = 'Không mở được luồng MJPEG ở cổng 55463: connect ECONNREFUSED 127.0.0.1:55463';
    const said = friendlyError(raw);
    assert.match(said, /Giữ máy lại/);
    assert.match(said, /Chi tiết kỹ thuật: .*ECONNREFUSED 127\.0\.0\.1:55463/);
  });

  it('Appium tắt: gọi đúng tên và chỉ chỗ bật', () => {
    assert.match(friendlyError('connect ECONNREFUSED 127.0.0.1:4723'), /Appium chưa chạy.*Local Runner/);
  });

  it('xcodebuild 70 và 65: nói profile hết hạn / bấm Tin cậy', () => {
    assert.match(friendlyError('xcodebuild failed with code 70. …'), /profile đã hết hạn/);
    assert.match(friendlyError('xcodebuild failed with code 65. …'), /Tin cậy/);
  });

  it('cổng bị simulator chiếm', () => {
    assert.match(friendlyError('Original error: The port #9100 is occupied by an other process.'), /Cổng 9100/);
  });

  it('phiên Appium đã đóng', () => {
    assert.match(friendlyError('A session is either terminated or not started'), /Phiên điều khiển/);
  });

  it('máy chủ đang khởi động lại (fetch hỏng)', () => {
    assert.match(friendlyError(new TypeError('Failed to fetch')), /máy chủ TestPilot/);
  });

  it('thiếu lệnh trên máy', () => {
    assert.match(friendlyError('spawn adb ENOENT'), /chưa cài lệnh "adb"/);
  });

  it('mã trần của server được thay hẳn, không kèm chi tiết', () => {
    assert.equal(friendlyError('forbidden'), 'Bạn không có quyền làm việc này.');
  });
});

describe('friendlyError — không làm hỏng câu đã tốt', () => {
  it('câu tiếng Việt không có dấu hiệu kỹ thuật: giữ nguyên', () => {
    const good = 'Chọn ít nhất một máy trước khi chạy.';
    assert.equal(friendlyError(good), good);
  });

  it('tên cấu hình có chữ "Timeout" không bị coi là lỗi hết giờ', () => {
    const good = 'Tăng ios.webviewTimeoutMs nếu máy chậm.';
    assert.equal(friendlyError(good), good);
  });

  it('đã dịch rồi thì không dịch lần hai (server dịch, giao diện gặp lại)', () => {
    const once = friendlyError('connect ECONNREFUSED 127.0.0.1:4723');
    assert.equal(friendlyError(once), once);
  });

  it('không nhận ra thì trả nguyên văn, không bịa', () => {
    assert.equal(friendlyError('Something odd happened'), 'Something odd happened');
  });

  it('rỗng thì vẫn có một câu', () => {
    assert.match(friendlyError(''), /Thử lại/);
  });
});

describe('friendlyStatus', () => {
  it('nói theo mã khi server không gửi câu nào', () => {
    assert.match(friendlyStatus(502), /khởi động lại/);
    assert.match(friendlyStatus(401), /Đăng nhập lại/);
    assert.match(friendlyStatus(500), /gặp lỗi/);
  });
});
