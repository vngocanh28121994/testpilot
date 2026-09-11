/**
 * Giao diện đổi thì healing phải tự vá — đo trên cả chuỗi, không từng mắt.
 *
 * Hai lỗi thật trong một ngày, cả hai đều nằm ở CHỖ NỐI chứ không ở mắt nào:
 *
 *   discovery bị bỏ đói thời gian  → lỗi ở cách Executor ghép ngân sách với
 *     Resolver; mỗi bên đứng riêng đều đúng.
 *   {strategy:'text'} bị dán nhãn xpath → lỗi ở adapter giữa discovery và
 *     resolver; hai đầu đều đúng, chỗ nối thì không ai hỏi.
 *
 * Từng mắt vốn đã có 11–16 file test; cả chuỗi thì có đúng một. Nên mỗi mắt
 * đúng mà chuỗi vẫn gãy, và chỉ một lượt chạy thật trên thiết bị mới lộ ra.
 *
 * Bảng dưới đây chạy Registry + Resolver + ElementDiscovery + ConfidenceScorer
 * THẬT. Thêm một kiểu đổi giao diện = thêm một object vào BANG, không sửa mã.
 *
 * Nó KHÔNG đo: tầng AI (cần model thật), đặc thù thiết bị (WebView, timing,
 * popup), và việc ngưỡng điểm đặt ở đâu là hợp lý.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Resolver } from '../resolver.js';
import { Registry } from '../../core/registry.js';
import { RuntimeRegistry } from '../../discovery/RuntimeRegistry.js';
import { ElementDiscovery } from '../../discovery/ElementDiscovery.js';
import type { ObservationProvider } from '../../discovery/ElementDiscovery.js';
import type { UiObservation, ObservedElement } from '../../discovery/UiObservation.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import type { LocatorCandidate } from '../../core/types.js';

/** Một phần tử trên màn hình mới, khai đúng những gì người dùng nhìn thấy. */
type ManHinh = Partial<ObservedElement> & { id: string };

interface Ca {
  ten: string;
  /**
   * Tầng AI trả về chiến lược này cho phần tử đúng.
   *
   * Có mặt ở đây vì lỗi thật hôm nay nằm đúng chỗ nối AI → locator: AI trả
   * {strategy:'text'} cho phần tử chỉ có chữ, bảng ánh xạ không có khoá đó, và
   * nhánh mặc định dán cho nó nhãn `xpath` trong khi giá trị vẫn là chữ. Bản
   * đầu của bảng này chỉ chạy tầng xác định nên KHÔNG bắt được — thử tái hiện
   * lỗi thì bảng vẫn xanh.
   */
  aiTraVe?: { strategy: string; layTu: 'text' | 'placeholder' | 'accessibilityLabel' };
  /** Locator registry đang giữ — đúng với giao diện CŨ, giờ không khớp gì nữa. */
  locatorCu: LocatorCandidate;
  /** Tên nghiệp vụ của phần tử, thứ duy nhất không đổi khi giao diện đổi. */
  nhan: string;
  manHinhMoi: ManHinh[];
  /** Phần tử mà healing phải tìm ra. */
  dungLa: string;
}

const BANG: Ca[] = [
  {
    // Ca có thật trên Device Farm 11/09: priceBoard.oMaCoPhieu chỉ có một
    // locator placeholder="Mã cổ phiếu", đã thắng 30 lần liên tiếp, rồi giao
    // diện đổi placeholder và cả kịch bản đỏ.
    ten: 'đổi placeholder',
    locatorCu: { strategy: 'placeholder', value: 'Mã cổ phiếu', weight: 0.5, origin: 'authored' as const },
    nhan: 'Ô mã cổ phiếu',
    manHinhMoi: [
      { id: 'o-tim', role: 'textbox', placeholder: 'TCB,VNM,FPT…', accessibilityLabel: 'Ô mã cổ phiếu' },
      { id: 'nut-them', role: 'button', text: 'Thêm mã' },
    ],
    dungLa: 'o-tim',
  },
  {
    ten: 'đổi testId',
    locatorCu: { strategy: 'testId', value: 'search-input-old', weight: 0.9, origin: 'authored' as const },
    nhan: 'Ô mã cổ phiếu',
    manHinhMoi: [
      { id: 'o-tim', role: 'textbox', testId: 'search-input-v2', accessibilityLabel: 'Ô mã cổ phiếu' },
      { id: 'o-khac', role: 'textbox', testId: 'amount-input' },
    ],
    dungLa: 'o-tim',
  },
  {
    ten: 'đổi chữ hiển thị của nút',
    locatorCu: { strategy: 'label', value: 'THÊM MÃ', weight: 0.7, origin: 'authored' as const },
    nhan: 'Thêm mã',
    manHinhMoi: [
      { id: 'nut-them', role: 'button', text: 'Thêm mã', accessibilityLabel: 'Thêm mã' },
      { id: 'nut-huy', role: 'button', text: 'Huỷ' },
    ],
    dungLa: 'nut-them',
  },
  {
    ten: 'mất testId, chỉ còn nhãn trợ năng',
    locatorCu: { strategy: 'testId', value: 'btn-add', weight: 0.9, origin: 'authored' as const },
    nhan: 'Thêm mã',
    manHinhMoi: [
      { id: 'nut-them', role: 'button', accessibilityLabel: 'Thêm mã' },
      { id: 'nut-khac', role: 'button', accessibilityLabel: 'Xoá khỏi danh mục' },
    ],
    dungLa: 'nut-them',
  },
  {
    ten: 'có phần tử gây nhiễu mang chữ gần giống',
    locatorCu: { strategy: 'testId', value: 'search-old', weight: 0.9, origin: 'authored' as const },
    nhan: 'Ô mã cổ phiếu',
    manHinhMoi: [
      { id: 'o-tim', role: 'textbox', placeholder: 'Mã cổ phiếu', accessibilityLabel: 'Ô mã cổ phiếu' },
      { id: 'o-nhieu', role: 'textbox', placeholder: 'Mã hợp đồng' },
      { id: 'nhan-tinh', role: 'text', text: 'Ô mã cổ phiếu' },
    ],
    dungLa: 'o-tim',
  },
];

const BANG_AI: Ca[] = [
  {
    ten: 'AI trả strategy "text" — chữ hiển thị là thứ duy nhất định danh',
    locatorCu: { strategy: 'testId', value: 'search-old', weight: 0.9, origin: 'authored' as const },
    nhan: 'Ô mã cổ phiếu',
    manHinhMoi: [{ id: 'o-tim', role: 'textbox', text: 'TCB,VNM,FPT…' }],
    dungLa: 'o-tim',
    aiTraVe: { strategy: 'text', layTu: 'text' },
  },
  {
    ten: 'AI trả strategy "label"',
    locatorCu: { strategy: 'testId', value: 'btn-old', weight: 0.9, origin: 'authored' as const },
    nhan: 'Thêm mã',
    manHinhMoi: [{ id: 'nut-them', role: 'button', accessibilityLabel: 'Thêm mã' }],
    dungLa: 'nut-them',
    aiTraVe: { strategy: 'label', layTu: 'accessibilityLabel' },
  },
];

const ELEMENT_ID = 'man.phanTu';

function quanSat(manHinh: ManHinh[]): UiObservation {
  return {
    id: 'obs',
    timestamp: new Date().toISOString(),
    platform: 'android',
    source: 'native',
    context: {},
    elements: manHinh.map((el, index) => ({
      role: 'unknown',
      visible: true,
      enabled: true,
      interactive: el.role !== 'text',
      index,
      ...el,
    })) as ObservedElement[],
  };
}

/**
 * Driver giả của giao diện MỚI.
 *
 * Chỉ khớp những locator thật sự mô tả được một phần tử đang có trên màn hình.
 * Đây là chỗ bắt được locator "trông hợp lệ mà không bao giờ khớp" — ví dụ
 * `xpath="TCB,VNM,FPT…"`, thứ đã lọt qua mọi test đơn lẻ.
 */
function driverCua(manHinh: ManHinh[], daTim: LocatorCandidate[]): UiDriver {
  const khop = (c: LocatorCandidate): ManHinh | undefined => manHinh.find((el) => {
    switch (c.strategy) {
      case 'testId': return el.testId === c.value;
      case 'placeholder': return el.placeholder === c.value;
      case 'label': return el.accessibilityLabel === c.value || el.text === c.value;
      case 'role': return el.role === c.value;
      // Một xpath thật luôn bắt đầu bằng '/' hoặc '('. Chuỗi chữ thường thì
      // không, và driver thật cũng sẽ không khớp được gì.
      case 'xpath': return /^[/(]/.test(c.value) ? undefined : undefined;
      default: return undefined;
    }
  });
  return {
    platform: 'android',
    device: 'test-device',
    start: async () => {},
    stop: async () => {},
    launch: async () => {},
    find: async (c: LocatorCandidate): Promise<UiHandle | null> => {
      daTim.push(c);
      const el = khop(c);
      if (!el) return null;
      return {
        text: async () => el.text ?? '',
        isVisible: async () => true,
        isEnabled: async () => true,
        getAttribute: async () => null,
        value: async () => '',
        __id: el.id,
      } as unknown as UiHandle;
    },
    tap: async () => {},
    input: async () => {},
    isIdle: async () => true,
    screenshot: async () => '',
  } as unknown as UiDriver;
}

async function chayThuHealing(ca: Ca) {
  const registry = await Registry.load('/dev/null/nonexistent-registry.json');
  registry.upsertElement({
    id: ELEMENT_ID,
    label: ca.nhan,
    screen: 'man',
    candidates: { android: [ca.locatorCu] },
  });

  const provider: ObservationProvider = { observe: async () => quanSat(ca.manHinhMoi) };
  const discovery = new ElementDiscovery(
    provider,
    await RuntimeRegistry.load('/dev/null/nonexistent-runtime.json'),
  );

  // Tầng AI giả: trả đúng phần tử cần tìm, bằng chiến lược mà ca này khai.
  // Nó đứng ở đúng chỗ tầng AI thật đứng, nên chỗ nối AI → locator nằm trong
  // đường đi được đo.
  const dich = ca.manHinhMoi.find((el) => el.id === ca.dungLa)!;
  const semantic = ca.aiTraVe
    ? {
        discover: async () => ({
          method: 'ai' as const,
          locator: { strategy: ca.aiTraVe!.strategy, value: String(dich[ca.aiTraVe!.layTu] ?? '') },
          match: { confidence: 90 },
          evidence: [],
        }),
      }
    : undefined;

  const daTim: LocatorCandidate[] = [];
  const driver = driverCua(ca.manHinhMoi, daTim);
  // Discovery là tham số THỨ TƯ của constructor, không phải một khoá trong
  // options — dựng sai chỗ này thì resolve chạy như không có discovery, và
  // bảng sẽ đỏ vì lý do chẳng liên quan gì tới cái nó định đo.
  const resolver = new Resolver(
    driver,
    registry,
    { timeoutMs: 8_000, pollMs: 50, requireVisible: true, verifyHealedMatch: false },
    discovery,
    semantic as never,
    40,
  );

  let loi: Error | undefined;
  const ketQua = await resolver
    .resolve(ELEMENT_ID, { discoveryAction: 'tap' })
    .catch((e: Error) => { loi = e; return undefined; });
  return {
    thangCuoc: (ketQua?.handle as { __id?: string } | undefined)?.__id,
    locatorMoi: ketQua?.candidate,
    daTim,
    loi,
  };
}

describe('healing khi giao diện đổi', () => {
  for (const ca of [...BANG, ...BANG_AI]) {
    it(ca.ten, async () => {
      const r = await chayThuHealing(ca);
      assert.equal(r.thangCuoc, ca.dungLa, `phải tìm ra ${ca.dungLa}; lỗi: ${r.loi?.message ?? '—'}`);
      assert.ok(r.locatorMoi, 'phải có locator thắng cuộc');
      // Locator mới phải KHÁC cái cũ — nếu trùng thì nó đã khớp từ đầu và ca
      // này không đo được gì.
      assert.notDeepEqual(
        { s: r.locatorMoi!.strategy, v: r.locatorMoi!.value },
        { s: ca.locatorCu.strategy, v: ca.locatorCu.value },
      );
    });
  }

  /**
   * Không có locator nào "trông hợp lệ mà không khớp được gì" lọt ra ngoài.
   * `xpath` mang giá trị là chữ thường là đúng cách lỗi hôm nay đã sinh ra.
   */
  it('không sinh ra xpath mang giá trị là chữ thường', async () => {
    for (const ca of [...BANG, ...BANG_AI]) {
      const { daTim } = await chayThuHealing(ca);
      const bay = daTim.filter((c) => c.strategy === 'xpath' && !/^[/(]/.test(c.value));
      assert.deepEqual(bay, [], `${ca.ten}: có locator xpath không phải xpath`);
    }
  });
});
