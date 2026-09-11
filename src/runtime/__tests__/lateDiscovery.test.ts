/**
 * Câu trả lời của discovery về đúng nhịp cuối thì vẫn phải được dùng.
 *
 * Năm lượt chạy thật ngày 11/09 trên SM-S938B kết thúc bằng cùng một cặp dòng,
 * cách nhau đúng một dòng log:
 *
 *   [discovery:ai] "priceBoard.oMaCoPhieu" → placeholder="TCB,VNM,FPT..." (tin cậy 85)
 *   … Could not resolve "priceBoard.oMaCoPhieu" on web after 3 attempts.
 *     Tried: placeholder=Mã cổ phiếu
 *
 * Tầng AI trả về ĐÚNG ô nhập, và thông báo lỗi khai rằng locator ấy chưa từng
 * được thử. Lý do nằm ở một khe giữa hai nhánh: `discovered` được gán trong
 * `.then()`, còn chỗ nhặt nó vào `candidates` ở đầu vòng kế tiếp — nên một câu
 * trả lời về trong nhịp `sleep` của vòng CUỐI thì vừa đã settled (nên nhánh
 * "chờ thêm" bỏ qua) vừa chưa kịp vào `candidates` (nên vòng lặp không thấy).
 * Ngân sách resolve ở bước postcondition chỉ đủ 2-3 vòng, nên khe này trúng
 * gần như mọi lần — ba buổi chẩn đoán đã đi tìm lý do model "bỏ qua" một câu
 * trả lời mà nó vẫn luôn đưa ra.
 *
 * Các mốc thời gian dưới đây dựng lại đúng cuộc đua đó, nên chúng là một phần
 * của phép đo chứ không phải số cho đẹp; xem chú thích ở chỗ đặt chúng.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Resolver } from '../resolver.js';
import { Registry } from '../../core/registry.js';
import { RuntimeRegistry } from '../../discovery/RuntimeRegistry.js';
import { ElementDiscovery } from '../../discovery/ElementDiscovery.js';
import type { ObservationProvider } from '../../discovery/ElementDiscovery.js';
import type { UiObservation } from '../../discovery/UiObservation.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import type { LocatorCandidate } from '../../core/types.js';

const ELEMENT_ID = 'priceBoard.oMaCoPhieu';
/** Locator cũ trong registry — giao diện đã đổi, nó không còn khớp gì. */
const LOCATOR_CU = 'Mã cổ phiếu';
/** Ô nhập thật trên màn hình mới. */
const PLACEHOLDER_MOI = 'TCB,VNM,FPT...';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function quanSatRong(): UiObservation {
  return {
    id: 'obs',
    timestamp: new Date().toISOString(),
    platform: 'android',
    source: 'native',
    context: {},
    elements: [],
  } as unknown as UiObservation;
}

/**
 * Driver giả: mỗi lần dò tốn thời gian thật.
 *
 * Một `find` không khớp trên Appium-trong-WebView tốn trung bình 3,4 giây; dò
 * tức thì thì vòng lặp quay nhanh tới mức không còn cuộc đua nào để đo.
 */
function driverGia(daTim: LocatorCandidate[], dungMs: number): UiDriver {
  return {
    platform: 'android',
    device: 'test-device',
    start: async () => {},
    stop: async () => {},
    launch: async () => {},
    find: async (c: LocatorCandidate): Promise<UiHandle | null> => {
      daTim.push(c);
      await sleep(dungMs);
      if (c.strategy !== 'placeholder' || c.value !== PLACEHOLDER_MOI) return null;
      return {
        text: async () => '',
        isVisible: async () => true,
        isEnabled: async () => true,
        getAttribute: async () => null,
        value: async () => '',
      } as unknown as UiHandle;
    },
    tap: async () => {},
    input: async () => {},
    isIdle: async () => true,
    screenshot: async () => '',
  } as unknown as UiDriver;
}

describe('discovery trả lời ở nhịp cuối', () => {
  it('câu trả lời về trong sleep của vòng cuối vẫn được thử', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-registry.json');
    registry.upsertElement({
      id: ELEMENT_ID,
      label: 'Ô mã cổ phiếu',
      screen: 'man',
      candidates: { android: [{ strategy: 'placeholder', value: LOCATOR_CU, weight: 0.9, origin: 'authored' }] },
    });

    const provider: ObservationProvider = { observe: async () => quanSatRong() };
    const discovery = new ElementDiscovery(
      provider,
      await RuntimeRegistry.load('/dev/null/nonexistent-runtime.json'),
    );

    /**
     * Tầng AI trả lời muộn — đủ muộn để rơi vào nhịp sleep của vòng cuối.
     *
     * Discovery khởi động ở vòng thứ 3 (~2.250 ms với các mốc dưới), cộng 400 ms
     * là ~2.650 ms, nằm gọn trong khoảng [2.400, 3.000] mà vòng cuối đang ngủ.
     */
    const semantic = {
      discover: async () => {
        await sleep(400);
        return {
          method: 'ai' as const,
          locator: { strategy: 'placeholder', value: PLACEHOLDER_MOI },
          match: { confidence: 85 },
          evidence: [],
        };
      },
    };

    const daTim: LocatorCandidate[] = [];
    // pollMs lớn để nhịp ngủ cuối rộng hẳn ra: cuộc đua cần đo là "về trong lúc
    // ngủ", không phải "về sớm hơn hay muộn hơn vài mili giây".
    const resolver = new Resolver(
      driverGia(daTim, 150),
      registry,
      { timeoutMs: 3_000, pollMs: 600, requireVisible: false, verifyHealedMatch: false },
      discovery,
      semantic as never,
      40,
    );

    const ketQua = await resolver.resolve(ELEMENT_ID, { discoveryAction: 'tap' });
    assert.equal(ketQua.candidate.value, PLACEHOLDER_MOI);
    assert.ok(
      daTim.some((c) => c.value === PLACEHOLDER_MOI),
      `locator do discovery tìm ra chưa từng được thử; chỉ thử: ${daTim.map((c) => `${c.strategy}=${c.value}`).join(', ')}`,
    );
  });
});
