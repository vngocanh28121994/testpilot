import { labelContainsXPath, labelSplitAcrossChildrenXPath } from './labelXPath.js';
import type { LocatorCandidate } from './types.js';

export interface LocatorQuality {
  score: number;
  stable: boolean;
  persistable: boolean;
  promotable: boolean;
  reasons: string[];
}

/**
 * Scores maintainability, not whether a locator happened to match once.
 * Runtime outcome verification remains authoritative for correctness; this
 * gate prevents a huge positional XPath from silently becoming production
 * registry state merely because it rescued one run.
 */
export function assessLocatorQuality(candidate: LocatorCandidate): LocatorQuality {
  const reasons: string[] = [];
  let score = 50;

  switch (candidate.strategy) {
    case 'testId': score = 98; reasons.push('developer-authored test id'); break;
    case 'role': {
      // Một cái tên toàn dấu câu thì không định danh được gì.
      //
      // Model lấy nguyên dấu ba chấm trong nhãn "Icon ... tại dòng ADS" làm tên
      // rồi ghi vào registry: `role=button name="…"`. Trên màn hình không có nút
      // nào tên là "…", nên phần tử ấy chưa từng resolve được lần nào — mà
      // locator vẫn đứng đó với 74 điểm, đủ để được lưu và được coi là dùng
      // tốt. Hai element đang ở tình trạng đó khi luật này được thêm.
      const coChu = candidate.name !== undefined && /[\p{L}\p{N}]/u.test(candidate.name);
      if (candidate.name !== undefined && !coChu) {
        score = 30;
        reasons.push('role with a name that identifies nothing');
      } else {
        score = coChu ? 92 : 74;
        reasons.push(coChu ? 'role with accessible name' : 'role without name');
      }
      break;
    }
    case 'relative': score = 86; reasons.push('structured row/container relation'); break;
    case 'placeholder': score = 82; reasons.push('semantic field placeholder'); break;
    case 'label': score = 70; reasons.push('human-visible label may change'); break;
    case 'predicate': score = 68; reasons.push('native predicate'); break;
    case 'css': {
      if (/^#[A-Za-z_][\w-]*$/.test(candidate.value)) {
        score = 92; reasons.push('unique id selector');
      } else if (/^[\w-]+(?:\[[\w-]+=(?:"[^"]+"|'[^']+')\])+$/.test(candidate.value)) {
        score = 90; reasons.push('stable attribute selector');
      } else if (/^[A-Za-z][\w-]*(?:\.[A-Za-z_][\w-]*)+$/.test(candidate.value)) {
        score = 84; reasons.push('semantic class selector');
      } else {
        score = 62; reasons.push('structural CSS selector');
      }
      if (/:nth-|\s[>+~]\s?|\[[^\]]*(?:\d{4,}|[a-f0-9]{10,})/i.test(candidate.value)) {
        score -= 25; reasons.push('contains positional or dynamic structure');
      }
      break;
    }
    case 'xpath': {
      score = 52;
      reasons.push('XPath fallback');
      if (candidate.value.length > 240) {
        score -= 22; reasons.push('excessively long');
      }
      if (/\[(?:\d+|last\(\))\]/.test(candidate.value)) {
        score -= 15; reasons.push('positional selection');
      }
      if (/ancestor::|contains\(concat\(|translate\(concat\(/.test(candidate.value)) {
        score -= 12; reasons.push('depends on broad DOM heuristics');
      }
      break;
    }
  }

  score = Math.max(0, Math.min(100, score));
  const persistable = score >= 45 || candidate.strategy === 'relative';
  const promotable = score >= 65;
  return { score, stable: score >= 80, persistable, promotable, reasons };
}

/**
 * Locator này có thể khớp một phần tử chỉ vì phần tử đó CHỨA cụm từ, thay vì
 * phần tử đó LÀ cụm từ.
 *
 * Phân biệt này không quan trọng khi ta đã biết mình đang ở đâu và chỉ cần bấm
 * đúng thứ — khớp chuỗi con vẫn tìm ra nút, và những locator kiểu ấy đã chứng
 * minh hàng trăm lần. Nó chỉ trở thành sai lầm khi locator được dùng để TRẢ LỜI
 * "màn hình nào đang mở": bất kỳ câu văn nào chứa cụm từ đều thành bằng chứng.
 *
 * Đo trên máy thật ngày 2026-09-15: `:text('Cơ sở')` của tab Bảng giá khớp dòng
 * mô tả "Công cụ phòng ngừa rủi ro giảm giá cho CK Cơ sở bằng HĐ phái sinh" —
 * một mục trong menu tính năng của Home. Runner kết luận Bảng giá đã mở sẵn,
 * bỏ qua điều hướng, rồi bốn kịch bản liên tiếp thao tác trên màn hình Home và
 * cùng hỏng ở bước bấm "Thêm mã".
 *
 * Một phạm vi thật — id, class hay thuộc tính — thu hẹp việc chứa đó về một
 * vùng của màn hình, nên nó không còn là bằng chứng lỏng. Tên thẻ đứng một mình
 * (`button:has-text(...)`) thì không: mọi trang đều có button.
 */
export function matchesByContainment(candidate: LocatorCandidate): boolean {
  switch (candidate.strategy) {
    case 'css': {
      if (!/:(?:text|has-text|text-matches)\s*\(/.test(candidate.value)) return false;
      // Phạm vi phải nằm NGOÀI đối số của pseudo. `:text-matches("Cơ sở.*")`
      // có dấu chấm, nhưng dấu chấm ấy thuộc biểu thức chính quy chứ không
      // phải một class — đọc cả chuỗi thì nó thành "đã có phạm vi" và luật tự
      // vô hiệu hoá mình ở đúng dạng locator lỏng nhất.
      const outsideArgs = candidate.value.replace(/\((?:[^()'"]|'[^']*'|"[^"]*")*\)/g, '()');
      return !/[#.[]/.test(outsideArgs);
    }
    case 'predicate':
      return /textContains\s*\(|descriptionContains\s*\(|\bCONTAINS\b/i.test(candidate.value);
    // Cả hai nền tảng native đều dịch placeholder thành CONTAINS, và `role` có
    // `name` thành `.textContains(name)` / `label CONTAINS`.
    case 'placeholder':
      return true;
    case 'role':
      return candidate.name !== undefined;
    case 'xpath':
      return /contains\s*\(/.test(candidate.value);
    // Các arm của `label` phần lớn là so khớp CHÍNH XÁC, nhưng không phải tất
    // cả: labelSplitAcrossChildrenXPath() dựng `contains(normalize-space(.))`
    // trên cả cây con cho cụm từ hai chữ trở lên, và labelContainsXPath() dựng
    // arm nới lỏng cho ba chữ trở lên.
    //
    // Hỏi thẳng hai hàm ấy thay vì chép lại ngưỡng. Bản đầu của luật này chép
    // mỗi ngưỡng ba chữ, nên `label="Cơ sở"` lọt qua — và lọt đúng vào arm cây
    // con, arm đã khớp dòng "…CK Cơ sở bằng HĐ phái sinh" và giữ nguyên lỗi cũ
    // sau khi luật đã được thêm. Ngưỡng ở đây mà lệch thì luật chỉ trông như
    // đang bảo vệ.
    case 'label':
      return labelSplitAcrossChildrenXPath(candidate.value) !== undefined
        || labelContainsXPath(candidate.value) !== undefined;
    default:
      return false;
  }
}

/**
 * Locator này chỉ mô tả HÌNH DẠNG của phần tử, không mô tả nội dung nào.
 *
 * `role:dialog` khớp mọi hộp thoại. `.subtitle-dialog-common` khớp mọi hộp
 * thoại dùng chung style ấy. Cả hai đều là locator tốt để BẤM khi đã biết mình
 * đang ở đâu — và không nói được một chữ nào về việc mình đang ở đâu.
 *
 * Đo trên máy thật ngày 2026-09-16: `transfer.thongBao` ("Thông báo", màn hình
 * Chuyển tiền) có đúng hai locator kiểu này. Trên màn Home, một hộp thoại thông
 * báo bất kỳ làm cả hai khớp, runner kết luận "Chuyển tiền đã mở sẵn", bỏ qua
 * bước mở Search, rồi thao tác trên màn hình sai. Cùng một element cũng đã khớp
 * lẫn với `login.errorMessage` qua `.subtitle-dialog-common` — cảnh báo trùng
 * element ở đầu lượt chạy đã nói ra điều đó trước khi nó gây hại.
 *
 * Luật này cố tình chặt, và chặt theo hướng an toàn: lọc nhầm một landmark tốt
 * thì runner chỉ đi đường điều hướng bình thường — lặp lại được, không phá
 * trạng thái. Nhận nhầm một landmark xấu thì cả loạt kịch bản chạy trên màn
 * hình sai mà vẫn báo PASS. Hai cái giá đó không cùng một cỡ.
 *
 * Trên chính màn hình Chuyển tiền, năm element khoẻ nhất — "Chọn TK nhận tiền",
 * "Chuyển từ", "Số tiền", "CHUYỂN", "Được chuyển" — đều định danh bằng text
 * chính xác và đều đi qua luật này. Landmark tốt không thiếu; thứ cần loại là
 * cái không định danh gì cả.
 */
export function matchesByShape(candidate: LocatorCandidate): boolean {
  switch (candidate.strategy) {
    // Một `name` là nội dung. `role:dialog` trần thì không.
    case 'role':
      return candidate.name === undefined;
    case 'css':
      return !/:(?:text|has-text|text-matches)\s*\(/.test(candidate.value)
        && !/#|\[\s*(?:id|name|title|alt|value|placeholder|aria-label|data-[\w-]+)\s*[~|^$*]?=/i
          .test(candidate.value);
    case 'xpath':
      return !/text\s*\(\)|normalize-space|@(?:id|name|title|alt|value|placeholder|aria-label|content-desc|resource-id|data-[\w-]+)/i
        .test(candidate.value);
    // UiSelector/NSPredicate: resourceId và text/description là nội dung;
    // className, index, instance chỉ là hình dạng.
    case 'predicate':
      return !/\b(?:text|description|resourceId|name|label|value|identifier)\b/i
        .test(candidate.value);
    // testId, label, placeholder, relative đều mang nội dung định danh.
    default:
      return false;
  }
}

/** A runtime-healed candidate stays below authored candidates until approval. */
export function asUnapprovedFallback(candidate: LocatorCandidate): LocatorCandidate {
  const quality = assessLocatorQuality(candidate);
  return {
    ...candidate,
    origin: 'healed',
    approved: false,
    weight: Math.min(candidate.weight, quality.stable ? 0.79 : quality.persistable ? 0.6 : 0.35),
  };
}
