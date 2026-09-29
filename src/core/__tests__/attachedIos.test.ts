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
import {
  attachedFromDevicectl,
  IOS_UNAVAILABLE,
  iphonesFromDevicectl,
  usableFromDevicectl,
  wiredIphones,
} from '../iosDevices.js';

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

describe('usableFromDevicectl — tên người dùng đặt cho máy', () => {
  it('mang theo tên máy ("iPhone của Anh") — thứ AVFoundation dùng để gọi màn hình qua USB', () => {
    const parsed = { result: { devices: [{
      hardwareProperties: { udid: '00008101-00096DA21EF1001E', marketingName: 'iPhone 12 Pro Max' },
      connectionProperties: { pairingState: 'paired', tunnelState: 'disconnected' },
      deviceProperties: { osVersionNumber: '26.6.1', name: 'iPhone của Anh' },
    }] } };
    assert.equal(usableFromDevicectl(parsed)[0]?.deviceName, 'iPhone của Anh');
    // Tên dòng máy vẫn là nhãn trong sổ máy, không bị thay.
    assert.equal(usableFromDevicectl(parsed)[0]?.name, 'iPhone 12 Pro Max');
  });
});

/**
 * iPhone mới cắm vào chưa bấm "Tin cậy" từng biến mất khỏi màn Thiết bị — người
 * dùng không biết máy có được nhận hay không. Nay nó hiện, kèm việc cần làm.
 */
describe('iphonesFromDevicectl — máy cắm mà chưa dùng được', () => {
  const device = (connection: Record<string, string>, props: Record<string, string> = {}) => ({
    result: { devices: [{
      hardwareProperties: { udid: UDID, marketingName: 'iPhone 15' },
      connectionProperties: connection,
      deviceProperties: { osVersionNumber: '18.0', ...props },
    }] },
  });

  it('chưa ghép đôi: vẫn hiện, kèm lời nhắc bấm Tin cậy', () => {
    const [found] = iphonesFromDevicectl(device({ pairingState: 'unpaired', tunnelState: 'disconnected' }));
    assert.equal(found?.udid, UDID);
    assert.equal(found?.unavailable, IOS_UNAVAILABLE.unpaired);
  });

  it('chưa bật Chế độ nhà phát triển: vẫn hiện, kèm đường tới công tắc', () => {
    const [found] = iphonesFromDevicectl(device(
      { pairingState: 'paired', tunnelState: 'disconnected' },
      { developerModeStatus: 'disabled' },
    ));
    assert.equal(found?.unavailable, IOS_UNAVAILABLE.developerMode);
  });

  it('sẵn sàng: không có unavailable', () => {
    const [found] = iphonesFromDevicectl(device(
      { pairingState: 'paired', tunnelState: 'connected' },
      { developerModeStatus: 'enabled' },
    ));
    assert.equal(found?.unavailable, undefined);
    assert.equal(found?.name, 'iPhone 15');
  });

  it('đã rút cáp thì không hiện, dù chưa ghép đôi hay đã ghép đôi', () => {
    assert.deepEqual(iphonesFromDevicectl(unplugged), []);
    assert.deepEqual(iphonesFromDevicectl(device({ pairingState: 'unpaired', tunnelState: 'unavailable' })), []);
  });
});

describe('wiredIphones — máy tunnel phải giữ', () => {
  const dev = (udid: string, connection: Record<string, string>) => ({
    hardwareProperties: { udid }, connectionProperties: connection,
  });
  it('chỉ máy cắm cáp, đã ghép đôi, chưa rút', () => {
    const parsed = { result: { devices: [
      dev('CAP', { pairingState: 'paired', tunnelState: 'disconnected', transportType: 'wired' }),
      dev('WIFI', { pairingState: 'paired', tunnelState: 'disconnected', transportType: 'localNetwork' }),
      dev('RUT', { pairingState: 'paired', tunnelState: 'unavailable' }),
      dev('CHUA-GHEP', { pairingState: 'unpaired', tunnelState: 'disconnected', transportType: 'wired' }),
    ] } };
    assert.deepEqual(wiredIphones(parsed), ['CAP']);
  });
});
