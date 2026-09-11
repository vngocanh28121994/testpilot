/**
 * Chữa được một bản ghi thì bản ghi cùng chỉ một control cũng phải khỏi.
 *
 * Đo trên máy thật 11/09: cùng một ô `mat-autocomplete-trigger` trên màn hình
 * thêm mã được đăng ký hai lần — `priceBoard.oMaCoPhieu` ("Ô mã cổ phiếu") và
 * `addStockModal.searchInput` ("Ô tìm kiếm mã cổ phiếu") — và cả hai cùng giữ
 * locator chết `placeholder="Mã cổ phiếu"`.
 *
 * Bản ghi thứ nhất chữa được sang `placeholder="TCB,VNM,FPT..."`. Bản ghi thứ
 * hai thì không: nhãn của nó đẩy tầng AI sang ô tìm kiếm toàn cục đang hiển thị
 * trên cùng màn hình, và luật head-word gạt đúng — ô đó thật sự sai. Kịch bản
 * dùng tên thứ hai vẫn chết, trong khi câu trả lời đã nằm sẵn trong registry
 * dưới một cái tên khác.
 *
 * Khoá nối là chính locator vừa chết.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Resolver } from '../resolver.js';
import { Registry } from '../../core/registry.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import type { LocatorCandidate } from '../../core/types.js';

const CHET = { strategy: 'placeholder', value: 'Mã cổ phiếu' } as const;
const SONG = { strategy: 'placeholder', value: 'TCB,VNM,FPT...' } as const;
const MAN = 'addStockModal';

function driverGia(): UiDriver {
  return {
    platform: 'web',
    device: 'test-device',
    start: async () => {}, stop: async () => {}, launch: async () => {},
    find: async (c: LocatorCandidate): Promise<UiHandle | null> =>
      c.strategy === SONG.strategy && c.value === SONG.value
        ? ({
            text: async () => '',
            isVisible: async () => true,
            isEnabled: async () => true,
            getAttribute: async () => null,
            value: async () => '',
          } as unknown as UiHandle)
        : null,
    tap: async () => {}, input: async () => {},
    isIdle: async () => true, screenshot: async () => '',
  } as unknown as UiDriver;
}

describe('lan bài học sang bản ghi cùng một control', () => {
  it('bản ghi cùng giữ locator đã chết nhận được locator mới', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-registry.json');
    registry.upsertElement({
      id: 'priceBoard.oMaCoPhieu', label: 'Ô mã cổ phiếu', screen: MAN,
      candidates: { web: [{ ...CHET, weight: 0.44, origin: 'authored' }] },
    });
    registry.upsertElement({
      id: 'addStockModal.searchInput', label: 'Ô tìm kiếm mã cổ phiếu', screen: MAN,
      candidates: { web: [{ ...CHET, weight: 0.79, origin: 'authored' }] },
    });

    const resolver = new Resolver(driverGia(), registry, {
      timeoutMs: 1_000, pollMs: 50, requireVisible: false, verifyHealedMatch: false,
    });

    // Đúng thứ tầng discovery trả về sau khi tìm lại trên UI thật.
    const handle = (await driverGia().find({ ...SONG, weight: 0.8, origin: 'healed' }))!;
    resolver.confirmResolution('priceBoard.oMaCoPhieu', {
      handle,
      candidate: { ...SONG, weight: 0.8, origin: 'healed' },
      healed: true,
      previous: { ...CHET, weight: 0.44, origin: 'authored' },
      attempts: 2,
    });

    const nhan = registry.raw.elements['addStockModal.searchInput']!.candidates.web ?? [];
    assert.ok(
      nhan.some((c) => c.strategy === SONG.strategy && c.value === SONG.value),
      `bản ghi thứ hai chưa nhận được locator mới; nó đang giữ: ${nhan.map((c) => `${c.strategy}=${c.value}`).join(', ')}`,
    );
  });

  it('bản ghi ở màn hình khác thì không nhận', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-registry.json');
    registry.upsertElement({
      id: 'priceBoard.oMaCoPhieu', label: 'Ô mã cổ phiếu', screen: MAN,
      candidates: { web: [{ ...CHET, weight: 0.44, origin: 'authored' }] },
    });
    // Cùng chuỗi locator nhưng ở màn hình khác thì không có cơ sở coi là một
    // control — chép sang là đoán, không phải suy ra.
    registry.upsertElement({
      id: 'order.maCoPhieu', label: 'Mã cổ phiếu đặt lệnh', screen: 'order',
      candidates: { web: [{ ...CHET, weight: 0.9, origin: 'authored' }] },
    });

    const resolver = new Resolver(driverGia(), registry, {
      timeoutMs: 1_000, pollMs: 50, requireVisible: false, verifyHealedMatch: false,
    });
    const handle = (await driverGia().find({ ...SONG, weight: 0.8, origin: 'healed' }))!;
    resolver.confirmResolution('priceBoard.oMaCoPhieu', {
      handle,
      candidate: { ...SONG, weight: 0.8, origin: 'healed' },
      healed: true,
      previous: { ...CHET, weight: 0.44, origin: 'authored' },
      attempts: 2,
    });

    const nhan = registry.raw.elements['order.maCoPhieu']!.candidates.web ?? [];
    assert.ok(!nhan.some((c) => c.value === SONG.value), 'không được chép sang màn hình khác');
  });
});
