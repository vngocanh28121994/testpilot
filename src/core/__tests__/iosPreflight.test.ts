/**
 * iPhone cắm ngay đó mà preflight bảo "không thấy máy thật nào".
 *
 * `devicectl list devices` liệt kê cả máy đã ghép đôi nhưng chưa dùng được:
 *
 *   Name             Hostname     Identifier   State         Model
 *   iPhone cua Anh   iPhone-...   7213F372-…   unavailable   iPhone 12 Pro Max
 *
 * Bộ lọc cũ chỉ giữ dòng có chữ `connected` rồi vứt phần còn lại, nên máy trên
 * biến mất hoàn toàn và người dùng được bảo đi "cắm iPhone" — cái iPhone đang
 * cắm sẵn. Nhánh Android đã xử lý đúng tình huống này cho `unauthorized` từ
 * lâu, kèm chú thích rằng đó là câu trả lời phổ biến nhất; iOS thì chưa.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDevicectl } from '../preflight.js';

/** Nguyên văn từ máy thật, không phải bảng tự nghĩ ra. */
const REAL = `Name             Hostname                          Identifier                             State         Model
--------------   -------------------------------   ------------------------------------   -----------   ------------------------------
iPhone cua Anh   iPhone-cua-Anh.coredevice.local   7213F372-F95A-5ADA-9DE7-C05178338F98   unavailable   iPhone 12 Pro Max (iPhone13,4)`;

describe('parseDevicectl', () => {
  it('giữ lại máy chưa dùng được thay vì vứt đi', () => {
    const devices = parseDevicectl(REAL);
    assert.equal(devices.length, 1);
    assert.equal(devices[0]!.name, 'iPhone cua Anh');
    assert.equal(devices[0]!.state, 'unavailable');
    assert.equal(devices[0]!.usable, false);
  });

  it('máy đang kết nối thì dùng được', () => {
    const devices = parseDevicectl(REAL.replace('unavailable', 'connected  '));
    assert.equal(devices[0]!.usable, true);
  });

  /**
   * `connected` không phải trạng thái dùng được duy nhất.
   *
   * Một iPhone nối qua tunnel CoreDevice (Xcode 15+/iOS 17+) báo là
   * `available (paired)`, và `xctrace` còn xếp nó vào "Devices Offline" —
   * nhưng nó dùng được thật. Đo trên máy người dùng, cùng thời điểm:
   *
   *   devicectl device info lockState → Acquired tunnel connection to device.
   *   developerModeStatus: enabled · unlockedSinceBoot: true
   *
   * Bắt đúng chữ `connected` khiến tool báo "chưa dùng được" cho một máy đã mở
   * khoá, đã tin cậy, đã bật Developer Mode — và người dùng đi sửa một thứ vốn
   * không hỏng. Đúng chuyện đã xảy ra.
   */
  it('available (paired) cũng là dùng được', () => {
    const devices = parseDevicectl(REAL.replace('unavailable', 'available (paired)'));
    assert.match(devices[0]!.state, /^available/);
    assert.equal(devices[0]!.usable, true);
  });

  it('unavailable thì vẫn là chưa dùng được', () => {
    assert.equal(parseDevicectl(REAL)[0]!.usable, false);
  });

  it('bỏ tiêu đề và đường kẻ', () => {
    for (const d of parseDevicectl(REAL)) {
      assert.notEqual(d.name, 'Name');
      assert.ok(!/^-+$/.test(d.name));
    }
  });

  it('không có máy nào thì trả danh sách rỗng, không ném', () => {
    assert.deepEqual(parseDevicectl('Name   Hostname   Identifier   State   Model\n----   ----   ----   ----   ----'), []);
    assert.deepEqual(parseDevicectl(''), []);
  });

  it('dòng thiếu cột thì bỏ qua, không đoán', () => {
    assert.deepEqual(parseDevicectl('rác  linh  tinh'), []);
  });
});
