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
import { deriveLocator, refineLocator } from '../../discovery/ai/locatorFromElement.js';

/** Ô nhập, xét cả vai trò web lẫn native — cùng bộ discovery chạy trên cả hai. */
function laODiaNhap(el: { role?: string }): boolean {
  return /input|textarea|textbox|searchfield|edittext|textfield/i.test(el.role ?? '');
}

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
  /**
   * Locator mà model TỰ đề xuất, thay vì để tool suy ra từ phần tử.
   *
   * `candidate.suggestedLocator ?? deriveLocator(el)` — có đề xuất thì mọi hiểu
   * biết trong deriveLocator bị bỏ qua. Đo trên máy thật: model chọn đúng ô
   * nhập ba lượt liền (tin cậy 85 → 95 → 90) rồi khai `label="TCB,VNM,FPT…"`,
   * và có lượt gán đúng chuỗi ấy cho cả một cái nút.
   */
  aiDeXuat?: { strategy: string; value: string };
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
    // Phần tử KHÔNG phải ô nhập: ở đây chữ hiển thị đúng là thứ định danh, và
    // khớp-theo-chữ là chiến lược đúng. Dòng này canh việc `text` được hiểu như
    // `label` thay vì bị dán nhãn `xpath`.
    ten: 'AI trả strategy "text" cho một nút — chữ hiển thị là thứ định danh',
    locatorCu: { strategy: 'testId', value: 'btn-old', weight: 0.9, origin: 'authored' as const },
    nhan: 'Thêm mã',
    manHinhMoi: [{ id: 'nut-them', role: 'button', text: 'Thêm mã' }],
    dungLa: 'nut-them',
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

/**
 * Ca thật thứ hai trong cùng một ngày: AI tìm ĐÚNG ô nhập rồi khai sai loại
 * locator. Cây native của Android phơi hint của một EditText rỗng ra ở thuộc
 * tính `text`, nên bộ chọn locator thấy chữ và khai là khớp-theo-chữ — trong
 * khi app là hybrid, bước resolve chạy trong WebView, và ở đó placeholder không
 * phải chữ hiển thị cũng không phải aria-label.
 */
const BANG_O_NHAP: Ca[] = [
  {
    ten: 'ô nhập rỗng: chuỗi nhìn thấy là placeholder, không phải chữ',
    locatorCu: { strategy: 'testId', value: 'search-old', weight: 0.9, origin: 'authored' as const },
    nhan: 'Ô mã cổ phiếu',
    // Cùng một chuỗi nằm ở cả `text` (cây native) lẫn `placeholder` (DOM).
    manHinhMoi: [
      { id: 'o-tim', role: 'input', text: 'TCB,VNM,FPT…', placeholder: 'TCB,VNM,FPT…' },
    ],
    dungLa: 'o-tim',
    // Tầng AI thật chọn chiến lược qua deriveLocator; ở đây ép nó đi qua đúng
    // nhánh đó bằng cách khai `text`, và bảng phải thấy locator thắng cuộc là
    // `placeholder` chứ không phải `label`.
    aiTraVe: { strategy: 'text', layTu: 'text' },
  },
];

/**
 * Ca thật thứ ba, cùng một ngày: bản sửa trước chỉ nổ khi observation CÓ trường
 * `placeholder` — mà cây native của Android thì không có. Hint của một EditText
 * rỗng đi ra ở `text`, nhiều khi cả ở content-desc, nên nhánh nhãn trợ năng
 * cướp mất và lại sinh ra `label="TCB,VNM,FPT…"`. Đo hai lượt liên tiếp: tin cậy
 * 85 rồi 95, locator vẫn là `label`, bước vẫn hụt.
 */
const BANG_NATIVE: Ca[] = [
  {
    ten: 'ô nhập trên cây native: hint đi ra ở text, không có trường placeholder',
    locatorCu: { strategy: 'testId', value: 'search-old', weight: 0.9, origin: 'authored' as const },
    nhan: 'Ô mã cổ phiếu',
    manHinhMoi: [{ id: 'o-tim', role: 'android.widget.EditText', text: 'TCB,VNM,FPT…' }],
    dungLa: 'o-tim',
    aiTraVe: { strategy: 'text', layTu: 'text' },
  },
  {
    ten: 'ô nhập có hint ở cả content-desc',
    locatorCu: { strategy: 'testId', value: 'search-old', weight: 0.9, origin: 'authored' as const },
    nhan: 'Ô mã cổ phiếu',
    manHinhMoi: [
      { id: 'o-tim', role: 'android.widget.EditText', accessibilityLabel: 'TCB,VNM,FPT…' },
    ],
    dungLa: 'o-tim',
    aiTraVe: { strategy: 'label', layTu: 'accessibilityLabel' },
  },
];

const BANG_DE_XUAT: Ca[] = [
  {
    ten: 'model tự đề xuất label cho hint của ô nhập — phải sửa thành placeholder',
    locatorCu: { strategy: 'testId', value: 'search-old', weight: 0.9, origin: 'authored' as const },
    nhan: 'Ô mã cổ phiếu',
    manHinhMoi: [{ id: 'o-tim', role: 'android.widget.EditText', text: 'TCB,VNM,FPT…' }],
    dungLa: 'o-tim',
    aiTraVe: { strategy: 'label', layTu: 'text' },
    aiDeXuat: { strategy: 'label', value: 'TCB,VNM,FPT…' },
  },
  {
    // Đề xuất đúng thì để yên: chốt này chỉ sửa chỗ khai sai loại, không phải
    // một bộ lọc đè lên mọi thứ model nói.
    ten: 'model đề xuất testId hợp lệ thì giữ nguyên',
    locatorCu: { strategy: 'placeholder', value: 'cũ', weight: 0.5, origin: 'authored' as const },
    nhan: 'Ô mã cổ phiếu',
    manHinhMoi: [{ id: 'o-tim', role: 'input', testId: 'ma-ck', placeholder: 'TCB,VNM,FPT…' }],
    dungLa: 'o-tim',
    aiTraVe: { strategy: 'testId', layTu: 'text' },
    aiDeXuat: { strategy: 'testId', value: 'ma-ck' },
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
      // Native: descriptionContains — hint có thể nằm ở content-desc hoặc text.
      // WebView: [placeholder="…"]. Ô nhập nào cũng khớp được bằng chuỗi gợi ý.
      case 'placeholder':
        return el.placeholder === c.value
          || (laODiaNhap(el) && (el.text === c.value || el.accessibilityLabel === c.value));
      // Một Ô NHẬP không có chữ hiển thị trong DOM: thứ nhìn thấy là placeholder.
      // Cây native của Android thì lại phơi hint ra ở `text`, nên nếu driver giả
      // cho `label` khớp `text` của ô nhập, nó sẽ tha cho đúng loại locator đã
      // làm hỏng một lượt chạy thật.
      case 'label':
        return el.accessibilityLabel === c.value
          || (!laODiaNhap(el) && el.text === c.value);
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
  // Gọi CHÍNH deriveLocator của tầng AI thật, thay vì tự khai một chiến lược.
  //
  // Bản trước tự trả `{strategy: ca.aiTraVe.strategy}` — nên nó đi vòng qua
  // đúng đoạn mã cần đo. Thử phá lại phần ưu tiên placeholder thì bảng vẫn
  // xanh: một dòng test trang trí, không phải một dòng canh cửa.
  const semantic = ca.aiTraVe
    ? {
        discover: async () => {
          const el = quanSat([dich]).elements[0]!;
          // Model thật có thể TỰ đề xuất locator; khi đó deriveLocator bị bỏ
          // qua hoàn toàn. Ca `aiDeXuat` dựng lại đúng nhánh đó — nhánh đã làm
          // hỏng ba lượt chạy liên tiếp.
          const locator = refineLocator(el, ca.aiDeXuat);
          if (!locator) return { method: 'failed' as const, evidence: ['không suy ra được locator'] };
          return { method: 'ai' as const, locator, match: { confidence: 90 }, evidence: [] };
        },
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
  for (const ca of [...BANG, ...BANG_AI, ...BANG_O_NHAP, ...BANG_NATIVE, ...BANG_DE_XUAT]) {
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
    for (const ca of [...BANG, ...BANG_AI, ...BANG_O_NHAP, ...BANG_NATIVE, ...BANG_DE_XUAT]) {
      const { daTim } = await chayThuHealing(ca);
      const bay = daTim.filter((c) => c.strategy === 'xpath' && !/^[/(]/.test(c.value));
      assert.deepEqual(bay, [], `${ca.ten}: có locator xpath không phải xpath`);
    }
  });
});
