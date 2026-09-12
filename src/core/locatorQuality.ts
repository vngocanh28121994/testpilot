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
