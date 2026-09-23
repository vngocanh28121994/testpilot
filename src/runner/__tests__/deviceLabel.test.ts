/**
 * Tên đọc được của một chiếc máy Android.
 *
 * Bài này có vì một lỗi đã sống nhiều tuần mà không ai thấy. Chuỗi mẫu của
 * regex đọc `getprop` bị thừa dấu escape, nên nó không khớp được dòng nào —
 * và vì mọi phép đọc đều có `?? udid` đứng sau, KHÔNG có gì báo lỗi. Danh
 * sách chọn máy lặng lẽ hiện số sê-ri cho mọi chiếc máy, cho tới khi có người
 * cắm một chiếc điện thoại thật vào và hỏi "máy này là máy gì".
 *
 * Bài học nằm ở hình dạng của lỗi, không ở cái regex: một đường rơi-về luôn
 * đúng về mặt kỹ thuật sẽ che mất việc đường chính không bao giờ chạy. Nên ở
 * đây có một bài kiểm đúng chuyện ấy — đường chính PHẢI chạy.
 *
 * Dữ liệu mẫu chép từ `adb shell getprop` thật: một Galaxy S23 Ultra và một
 * emulator, đo ngày 2026-09-23.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deviceLabel, parseProps } from '../androidControl.js';

/** Đúng hình dạng `getprop` in ra, kèm vài dòng nhiễu quanh nó. */
const SAMSUNG = `
[ro.build.version.release]: [16]
[ro.config.ringtone]: [ACH_Galaxy_Bells.ogg]
[ro.product.manufacturer]: [samsung]
[ro.product.model]: [SM-S918B]
[ro.product.name]: [dm3qxxx]
`.trim();

const EMULATOR = `
[ro.build.version.release]: [16]
[ro.product.manufacturer]: [Google]
[ro.product.model]: [sdk_gphone64_arm64]
`.trim();

describe('đọc getprop', () => {
  it('đường chính CHẠY — không rơi về số sê-ri', () => {
    // Chính là bài mà lỗi cũ sẽ trượt.
    const props = parseProps(SAMSUNG);
    assert.equal(props.get('ro.product.model'), 'SM-S918B');
    assert.equal(props.get('ro.build.version.release'), '16');
  });

  it('bỏ qua dòng rác, không ném', () => {
    const props = parseProps('rác\n[thieu-dau-dong: [x]\n[ok]: [1]\n\n');
    assert.equal(props.get('ok'), '1');
    assert.equal(props.size, 1);
  });

  it('giá trị rỗng coi như không có', () => {
    // `getprop` in ra hàng trăm khoá có giá trị rỗng; chúng không phải câu
    // trả lời, và để chúng vào bảng nghĩa là `?? ` ở tầng trên thôi chạy.
    assert.equal(parseProps('[ro.product.model]: []').size, 0);
  });
});

describe('nhãn của máy', () => {
  it('điện thoại thật: hãng + model + phiên bản', () => {
    // "SM-S918B" một mình thì phải đi tra; thêm hãng là nhận ra được ngay.
    assert.equal(
      deviceLabel('R5CW525G35Y', parseProps(SAMSUNG)),
      'Samsung SM-S918B · Android 16',
    );
  });

  it('máy giả lập KHÔNG ghép tên hãng', () => {
    // "Google sdk_gphone64_arm64" dài hơn mà không nói thêm gì — hậu tố
    // "· emulator" đã trả lời đúng câu hỏi mà tên hãng định trả lời.
    assert.equal(
      deviceLabel('emulator-5554', parseProps(EMULATOR)),
      'sdk_gphone64_arm64 · Android 16 · emulator',
    );
  });

  it('có tên thương mại thì dùng nó, không ghép hãng nữa', () => {
    const props = parseProps([
      '[ro.product.marketname]: [Pixel 8 Pro]',
      '[ro.product.manufacturer]: [Google]',
      '[ro.product.model]: [GC3VE]',
      '[ro.build.version.release]: [15]',
    ].join('\n'));
    assert.equal(deviceLabel('ABC123', props), 'Pixel 8 Pro · Android 15');
  });

  it('model đã mang tên hãng thì không lặp lại', () => {
    const props = parseProps([
      '[ro.product.manufacturer]: [Xiaomi]',
      '[ro.product.model]: [Xiaomi 14]',
    ].join('\n'));
    assert.equal(deviceLabel('X1', props), 'Xiaomi 14');
  });

  it('không đọc được gì thì mới rơi về số sê-ri', () => {
    // Đường cuối. Nó đúng về mặt kỹ thuật và vô dụng với người đang chọn máy,
    // nên mọi nhánh trên tồn tại để không phải dùng tới nó.
    assert.equal(deviceLabel('R5CW525G35Y', parseProps('')), 'R5CW525G35Y');
  });
});
