import { controlNamesAgree } from './controlNames.js';
import type { ElementDef } from './types.js';

/**
 * Hai bản ghi element cho cùng MỘT control trên màn hình.
 *
 * Chuyện này xảy ra tự nhiên chứ không phải do ai cẩu thả: mỗi lần một feature
 * mới được soạn, control cũ được đặt lại tên theo cách kịch bản mới gọi nó, và
 * registry có thêm một bản ghi. Bản mới bắt đầu từ con số không — locator yếu,
 * chưa lần nào chứng minh được gì — trong khi bản cũ ngay cạnh đó đã có
 * locator tốt và hàng chục lần thắng.
 *
 * Trả giá thì lượt chạy trả: bước dùng bản mới hỏng, còn cách chữa nằm sẵn
 * trong registry dưới một cái tên khác. Cảnh báo ở cuối `run` từ lâu đã bảo
 * người soạn "nếu control này đã tồn tại dưới tên khác thì thêm alias" — mà
 * không nói được là tên nào, nên việc tìm vẫn là việc tay.
 *
 * Hàm này đi tìm cái tên đó, và chỉ chấp nhận bằng chứng cứng: hai element
 * cùng THẮNG bằng một locator. Không suy từ tên, không suy từ màn hình.
 */
export interface DuplicateElementPair {
  /** Bản ghi có lịch sử dài hơn — bên đáng tin hơn khi hai bên lệch nhau. */
  strong: string;
  /** Bản ghi ít lịch sử hơn, thường là bản mới sinh ra khi soạn feature mới. */
  weak: string;
  /** Locator mà cả hai đều từng thắng — bằng chứng của kết luận. */
  sharedLocator: string;
  /**
   * Khoá thắng NGUYÊN VĂN ở bên `strong`.
   *
   * `sharedLocator` đã bỏ dấu để so sánh được "Xoá" với "Xóa", nên nó không
   * dựng ngược lại thành locator được. Muốn hành động trên cặp này thì phải
   * giữ bản nguyên văn, và giữ của bên nhiều lịch sử hơn.
   */
  strongKey: string;
  /** Tỉ lệ locator ấy chiếm trong lịch sử thắng của mỗi bên: [strong, weak]. */
  share: [number, number];
}

/**
 * Locator thắng cho càng nhiều element thì càng không nói được element nào.
 *
 * Đo trên registry thật: `role:button` thắng cho 6 element khác nhau, và
 * `label:add` cho 2 element không liên quan (nút thêm báo cáo, nút thêm thẻ) —
 * đó là chữ trên một icon, không phải danh tính của control.
 */
const GENERIC_AT_LEAST = 3;

/**
 * Locator phải là đường chính của element, không phải một lần trúng.
 *
 * Nếu không có ngưỡng này, `placeholder:tìm kiếm` — thắng đúng 1 lần trên
 * 1073 lượt của "Nút tìm kiếm" và 2 lần trên 1101 lượt của "Kết quả tìm kiếm
 * đầu tiên" — đủ để kết luận hai control khác hẳn nhau là một.
 */
const PRINCIPAL_SHARE = 0.25;

/** Khoá thắng, bỏ dấu và bỏ vị trí dấu thanh: "Xoá"/"Xóa" là một. */
function foldKey(key: string): string {
  return key.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('vi-VN');
}

export function findDuplicateElements(
  elements: Record<string, ElementDef>,
): DuplicateElementPair[] {
  const wins = new Map<string, Map<string, number>>();
  const original = new Map<string, Map<string, string>>();
  const total = new Map<string, number>();
  const spread = new Map<string, Set<string>>();

  for (const [id, element] of Object.entries(elements)) {
    const raw = element.health?.winners ?? {};
    const folded = new Map<string, number>();
    const keys = new Map<string, string>();
    for (const [key, count] of Object.entries(raw)) {
      // Locator có tham số chạy theo từng dòng/từng giá trị, nên hai element
      // "cùng thắng bằng {{text}}" không nói lên điều gì về danh tính.
      if (key.includes('{{')) continue;
      const k = foldKey(key);
      folded.set(k, (folded.get(k) ?? 0) + count);
      if (!keys.has(k)) keys.set(k, key);
      if (!spread.has(k)) spread.set(k, new Set());
      spread.get(k)!.add(id);
    }
    if (folded.size === 0) continue;
    wins.set(id, folded);
    original.set(id, keys);
    total.set(id, [...folded.values()].reduce((sum, n) => sum + n, 0));
  }

  const ids = [...wins.keys()];
  const pairs: DuplicateElementPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      if (!controlNamesAgree(elements[a]!.label, elements[b]!.label)) continue;
      for (const [key, countA] of wins.get(a)!) {
        const countB = wins.get(b)!.get(key);
        if (countB === undefined) continue;
        if ((spread.get(key)?.size ?? 0) >= GENERIC_AT_LEAST) continue;
        const shareA = countA / total.get(a)!;
        const shareB = countB / total.get(b)!;
        if (shareA < PRINCIPAL_SHARE || shareB < PRINCIPAL_SHARE) continue;
        // Bên nào nhiều lịch sử hơn thì bên ấy là bản gốc: bản trùng luôn là
        // bản sinh sau, khi một feature mới đặt lại tên cho control cũ.
        const [strong, weak] = total.get(a)! >= total.get(b)! ? [a, b] : [b, a];
        pairs.push({
          strong,
          weak,
          sharedLocator: key,
          strongKey: original.get(strong)!.get(key)!,
          share: strong === a ? [shareA, shareB] : [shareB, shareA],
        });
        break;
      }
    }
  }
  // Bằng chứng mạnh nhất lên trước: cặp nào locator ấy là đường chính của cả
  // hai bên thì gần như chắc chắn là một control.
  return pairs.sort((x, y) => Math.min(...y.share) - Math.min(...x.share));
}
