/**
 * Cái gì nhận thẳng, cái gì chờ người duyệt.
 *
 * Một runner kết thúc lượt chạy với hai loại thứ học được, và trộn chúng làm
 * một là sai ở cả hai chiều:
 *
 *  - **Element MỚI.** Máy vừa gặp một control chưa có tên trong registry. Nhận
 *    thẳng, vì nó không đè lên gì cả — và bắt người duyệt bấm đồng ý cho hai
 *    trăm element mới mỗi tuần là cách chắc chắn nhất khiến họ bấm mà không
 *    đọc, rồi thứ thực sự cần đọc trôi qua cùng lúc.
 *  - **Locator ĐỔI.** Máy heal được một bước: locator cũ hỏng, cái mới chạy.
 *    Cái này ĐÈ lên thứ người khác đã đặt, nên mặc định là chờ duyệt.
 *
 * Ngoại lệ của vế thứ hai là chỗ đáng cân nhắc nhất trong file này: một
 * locator đã THẮNG đủ nhiều lần thì nó không còn là phỏng đoán nữa — nó là
 * quan sát. `ElementHealth.winners` đếm đúng số ấy, và ngưỡng lấy đúng ngưỡng
 * mà màn Healing đã dùng (`minSuccesses: 3`), vì hai con số khác nhau cho cùng
 * một câu hỏi là cách sinh ra hai câu trả lời khác nhau cho cùng một locator.
 *
 * Không nhận tự động thứ XOÁ. Một lượt chạy không bao giờ chứng minh được rằng
 * một element không còn tồn tại — nó chỉ chứng minh rằng lượt ấy không gặp.
 */
import type { ElementDef, ElementRegistry } from '../../core/types.js';

/** Bao nhiêu lần thắng thì một locator thôi là phỏng đoán. Bằng `minSuccesses`
 *  của chính sách healing — xem `healingState()` trong routes/healing.ts. */
export const AUTO_ACCEPT_WINS = 3;

export interface Split {
  /** Phần nhận thẳng: gộp vào registry ngay, không ai phải bấm gì. */
  autoMerge: ElementRegistry;
  /** Phần chờ duyệt, hoặc `undefined` khi không có gì phải chờ. */
  needsReview?: ElementRegistry;
  /** Vì sao từng element phải chờ — để màn duyệt khỏi phải tự đoán. */
  reasons: Record<string, string>;
}

const EMPTY = (): ElementRegistry => ({ version: 1, screens: {}, elements: {} });

/**
 * Chia phần một lượt chạy học được thành "nhận ngay" và "chờ duyệt".
 *
 * `current` là registry ĐANG có trên server. Cần nó để biết một element là mới
 * hay là đè: cùng một `learned.json` có nghĩa khác nhau tuỳ vào registry bên
 * này đã có gì, và runner thì không biết điều đó.
 */
export function split(delta: ElementRegistry, current: ElementRegistry): Split {
  const result: Split = { autoMerge: EMPTY(), reasons: {} };
  const review = EMPTY();

  // Màn hình đi theo phần nhận thẳng: chúng là mô tả, không phải locator, và
  // không có gì để hỏng khi nhận nhầm một cái tên màn hình.
  result.autoMerge.screens = { ...(delta.screens ?? {}) };

  for (const [id, learned] of Object.entries(delta.elements ?? {})) {
    const existing = current.elements?.[id];
    if (!existing) {
      result.autoMerge.elements[id] = learned;
      continue;
    }
    const changed = changedPlatforms(existing, learned);
    if (changed.length === 0) {
      // Không khác gì bản đang có. Vẫn cho vào phần nhận thẳng để `merge()`
      // cộng dồn `health` — số lần thắng là thứ nuôi chính ngưỡng ở dưới.
      result.autoMerge.elements[id] = learned;
      continue;
    }
    const unproven = changed.filter((platform) => !proven(learned, platform));
    if (unproven.length === 0) {
      result.autoMerge.elements[id] = learned;
      continue;
    }
    review.elements[id] = learned;
    result.reasons[id] = `Locator ${unproven.join(', ')} đổi nhưng chưa thắng đủ `
      + `${AUTO_ACCEPT_WINS} lần.`;
  }

  if (Object.keys(review.elements).length > 0) result.needsReview = review;
  return result;
}

/** Nền tảng nào có primary khác với bản đang có. */
function changedPlatforms(existing: ElementDef, learned: ElementDef): string[] {
  const changed: string[] = [];
  for (const [platform, candidates] of Object.entries(learned.candidates ?? {})) {
    const next = candidates?.[0];
    if (!next) continue;
    const now = existing.candidates?.[platform as keyof typeof existing.candidates]?.[0];
    if (!now) continue; // Nền tảng mới trên một element cũ: thêm, không đè.
    if (now.strategy !== next.strategy || now.value !== next.value) changed.push(platform);
  }
  return changed;
}

/** Locator này đã thắng đủ nhiều lần thật chưa. */
function proven(element: ElementDef, platform: string): boolean {
  const candidate = element.candidates?.[platform as keyof typeof element.candidates]?.[0];
  if (!candidate) return false;
  return (element.health?.winners?.[candidate.value] ?? 0) >= AUTO_ACCEPT_WINS;
}
