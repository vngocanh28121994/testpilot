/**
 * Máy đã rút ra vẫn hiện chấm xanh "đang cắm".
 *
 * Người dùng rút iPhone để cắm Android vào, bấm "Kiểm tra máy đang cắm", và màn
 * chọn máy vẫn báo 2 máy — rồi hứa "chạy song song" trên một chiếc không có mặt.
 *
 * Nguyên nhân: bộ lọc đọc `pairingState`. Ghép đôi là chuyện của quá khứ, nó
 * giữ nguyên kể cả khi máy nằm trong ngăn kéo. JSON dưới đây là nguyên văn
 * devicectl trả về ngay sau khi rút cáp.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attachedFromDevicectl, usableFromDevicectl } from '../iosDevices.js';

const UDID = '00008101-00096DA21EF1001E';

/** Nguyên văn từ máy thật, chỉ giữ các trường liên quan. */
const unplugged = {
  result: { devices: [{
    hardwareProperties: { udid: UDID },
    connectionProperties: {
      authenticationType: 'manualPairing',
      pairingState: 'paired',
      tunnelState: 'unavailable',
    },
  }] },
};

describe('máy iOS nào đang thật sự cắm', () => {
  it('đã rút cáp thì không tính, dù vẫn còn ghép đôi', () => {
    assert.deepEqual(attachedFromDevicectl(unplugged), []);
  });

  it('đang cắm thì tính', () => {
    const plugged = structuredClone(unplugged);
    plugged.result.devices[0]!.connectionProperties.tunnelState = 'connected';
    assert.deepEqual(attachedFromDevicectl(plugged), [UDID]);
  });

  /** Chưa ghép đôi thì không dùng được, dù tunnel có nói gì đi nữa. */
  it('chưa ghép đôi thì không tính', () => {
    const unpaired = structuredClone(unplugged);
    unpaired.result.devices[0]!.connectionProperties.pairingState = 'unpaired';
    unpaired.result.devices[0]!.connectionProperties.tunnelState = 'connected';
    assert.deepEqual(attachedFromDevicectl(unpaired), []);
  });

  it('devicectl trả về rỗng thì không nổ', () => {
    assert.deepEqual(attachedFromDevicectl({}), []);
    assert.deepEqual(attachedFromDevicectl({ result: {} }), []);
  });
});

describe('usableFromDevicectl — nhãn cho sổ máy', () => {
  it('cùng luật với attachedFromDevicectl, kèm tên và phiên bản iOS', () => {
    const parsed = { result: { devices: [
      {
        hardwareProperties: { udid: '00008101-00096DA21EF1001E', marketingName: 'iPhone 12 Pro Max' },
        connectionProperties: { pairingState: 'paired', tunnelState: 'disconnected' },
        deviceProperties: { osVersionNumber: '26.6.1' },
      },
      {
        hardwareProperties: { udid: 'rut-ra-roi', marketingName: 'iPhone 15' },
        connectionProperties: { pairingState: 'paired', tunnelState: 'unavailable' },
      },
    ] } };
    assert.deepEqual(usableFromDevicectl(parsed), [
      { udid: '00008101-00096DA21EF1001E', name: 'iPhone 12 Pro Max', osVersion: '26.6.1' },
    ]);
    assert.deepEqual(attachedFromDevicectl(parsed), ['00008101-00096DA21EF1001E']);
  });
});
