/**
 * Thêm một chiếc máy đang cắm vào danh sách máy của config.
 *
 * Điều phải giữ khi sửa file này: **chỉ THÊM**. Một dòng đã có được giữ nguyên
 * từng chữ, vì `id` của nó chịu lực — tên thư mục lượt chạy dựng từ nó và
 * `HealingStore` gộp theo nó. Sửa một `id` đang dùng là tách lịch sử của chiếc
 * máy ấy làm hai mà không ai báo.
 *
 * Phần logic này dùng chung giữa `npm run devices:sync` và nút "Thêm vào cấu
 * hình" trên web. Hai bản chép tay của cùng một luật đặt tên sẽ lệch, và lúc
 * ấy cùng một chiếc máy có hai `id` khác nhau tuỳ người thêm nó bằng đường nào.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerDevices, unregisteredDevices, uniqueId } from '../deviceSync.js';
import { ConfigSchema, type TestPilotConfig } from '../../config.js';

function config(devices?: unknown[]): TestPilotConfig {
  return ConfigSchema.parse({
    web: { baseUrl: 'https://x.dev' },
    ...(devices ? { android: { devices } } : {}),
  });
}

const TWO_PHONES = () => config([
  { id: 'sm-s918b', deviceName: 'SM_S918B', udid: 'R5CW525G35Y', systemPort: 8200 },
  { id: 'sm-s938b', deviceName: 'SM_S938B', udid: 'R5CY21WADDY', systemPort: 8201 },
]);

describe('máy nào chưa khai', () => {
  it('máy đã khai thì không hỏi lại', () => {
    const found = unregisteredDevices(TWO_PHONES(), 'android', [
      { udid: 'R5CW525G35Y' },
      { udid: 'emulator-5554', model: 'sdk_gphone64_arm64' },
    ]);
    assert.deepEqual(found.map((d) => d.udid), ['emulator-5554']);
  });

  it('khớp cả theo deviceName, không chỉ theo udid', () => {
    // Config cũ khai `deviceName` mà không khai `udid`; `adb` thì luôn trả về
    // serial. Bỏ nhánh này là mời người dùng thêm lần thứ hai một chiếc máy họ
    // đã khai rồi.
    const cfg = config([{ id: 'may-cu', deviceName: 'emulator-5554' }]);
    assert.deepEqual(unregisteredDevices(cfg, 'android', [{ udid: 'emulator-5554' }]), []);
  });
});

describe('thêm máy vào config', () => {
  it('đặt id theo model, và cấp cổng chưa ai dùng', () => {
    const cfg = TWO_PHONES();
    const { added } = registerDevices(cfg, 'android', [
      { udid: 'emulator-5554', model: 'sdk_gphone64_arm64' },
    ]);

    assert.equal(added.length, 1);
    assert.equal(added[0]!.id, 'sdk-gphone64-arm64');
    assert.equal(added[0]!.udid, 'emulator-5554');
    assert.equal(added[0]!.systemPort, 8202, 'không đụng 8200/8201 của config');
  });

  it('KHÔNG đụng vào dòng đã có', () => {
    const cfg = TWO_PHONES();
    const before = JSON.stringify(cfg.android.devices);
    registerDevices(cfg, 'android', [{ udid: 'R5CW525G35Y', model: 'SM_S918B' }]);
    assert.equal(JSON.stringify(cfg.android.devices), before);
  });

  it('hai máy cùng model thì cái thứ hai có hậu tố, không ghi đè', () => {
    const cfg = config([]);
    const { added } = registerDevices(cfg, 'android', [
      { udid: 'AAA', model: 'SM-S918B' },
      { udid: 'BBB', model: 'SM-S918B' },
    ]);
    assert.deepEqual(added.map((d) => d.id), ['sm-s918b', 'sm-s918b-2']);
    assert.deepEqual(added.map((d) => d.systemPort), [8200, 8201]);
  });

  it('không có model thì lấy sáu ký tự cuối của serial', () => {
    // Vẫn ngắn hơn cả serial và vẫn phân biệt được — thứ người ta đọc trong
    // tên thư mục lượt chạy.
    const { added } = registerDevices(config([]), 'android', [{ udid: 'R5CW525G35Y' }]);
    assert.equal(added[0]!.id, '25g35y');
  });

  it('nền tảng chưa có danh sách nào thì tạo danh sách từ máy tìm thấy', () => {
    const cfg = config();
    assert.equal(cfg.android.devices, undefined);
    registerDevices(cfg, 'android', [{ udid: 'emulator-5554' }]);
    // `?.length` không dùng được: sau khi `assert.equal(..., undefined)` ở
    // trên, TypeScript thu hẹp kiểu xuống `never`. Đọc lại qua một biến mới.
    const after = (cfg.android as { devices?: unknown[] }).devices;
    assert.equal(after?.length, 1);
  });

  it('gọi hai lần không tạo dòng thứ hai', () => {
    const cfg = config([]);
    registerDevices(cfg, 'android', [{ udid: 'emulator-5554' }]);
    const { added } = registerDevices(cfg, 'android', [{ udid: 'emulator-5554' }]);
    assert.deepEqual(added, []);
    assert.equal(cfg.android.devices?.length, 1);
  });
});

describe('id gợi ý', () => {
  it('bỏ ký tự lạ và viết thường', () => {
    assert.equal(uniqueId({ udid: 'X', model: 'SM_S918B' }, []), 'sm-s918b');
  });

  it('model toàn ký tự lạ thì vẫn ra một cái tên dùng được', () => {
    // Một `id` rỗng là một tên thư mục lượt chạy rỗng.
    assert.equal(uniqueId({ udid: 'X', model: '///' }, []), 'device');
  });
});
