/**
 * Cắt một kịch bản ra khỏi file feature và ghép nó trở lại.
 *
 * Cần đến vì API chỉ nhận cả file (`PUT /api/feature` kèm `baseRevision`), còn
 * người dùng thì sửa đúng một kịch bản. Đưa cả file vào một ô textarea là cách
 * để họ vô tình xoá kịch bản bên cạnh — bản React đầu tiên làm đúng như vậy.
 */

export interface ScenarioBounds {
  /** Dòng đầu, đã lùi lên hết các dòng @tag đứng ngay trên. */
  start: number;
  /** Dòng ngay sau dòng cuối, theo lối nửa mở như Array.slice. */
  end: number;
}

const HEADING = /^Scenario(?:\s+Outline)?:|^Feature:|^Background:/;
const SCENARIO_LINE = /^Scenario(?:\s+Outline)?:\s*(.+)$/;

export function findScenarioBounds(lines: string[], scenarioName: string): ScenarioBounds | null {
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i]!.trim().match(SCENARIO_LINE);
    if (!match || match[1]!.trim() !== scenarioName.trim()) continue;

    // Tag đứng trên tên kịch bản là của kịch bản đó, nên phải đi kèm.
    let start = i;
    while (start > 0 && lines[start - 1]!.trim().startsWith('@')) start -= 1;

    let end = i + 1;
    while (end < lines.length) {
      const text = lines[end]!.trim();
      if (HEADING.test(text)) break;
      // Một khối @tag chỉ kết thúc kịch bản này khi nó thuộc về kịch bản sau.
      // Tag lẻ giữa các bước (hiếm, nhưng hợp lệ) thì không.
      if (text.startsWith('@')) {
        let peek = end + 1;
        while (peek < lines.length && lines[peek]!.trim().startsWith('@')) peek += 1;
        if (peek < lines.length && SCENARIO_LINE.test(lines[peek]!.trim())) break;
      }
      end += 1;
    }
    return { start, end };
  }
  return null;
}

/** Khối của riêng kịch bản, hoặc chuỗi rỗng nếu không tìm thấy tên đó. */
export function extractScenario(content: string, scenarioName: string): string {
  const lines = content.split('\n');
  const bounds = findScenarioBounds(lines, scenarioName);
  if (!bounds) return '';
  return lines.slice(bounds.start, bounds.end).join('\n').trim();
}

export function replaceScenario(content: string, scenarioName: string, block: string): string {
  const lines = content.split('\n');
  const bounds = findScenarioBounds(lines, scenarioName);
  if (!bounds) return content;
  const next = block.split('\n');
  const rest = lines.slice(bounds.end);
  // Khối gửi vào đã bị trim, nên thiếu dòng này thì kịch bản kế tiếp dính liền
  // vào bước cuối của kịch bản vừa sửa — mỗi lần lưu lại đẻ ra một diff chạm
  // vào những dòng không ai đụng tới.
  if (rest.length > 0 && rest[0]?.trim()) next.push('');
  return [...lines.slice(0, bounds.start), ...next, ...rest].join('\n');
}

export function appendScenario(content: string, block: string): string {
  // trimEnd chứ không trim: thụt lề của khối là có nghĩa.
  const base = content.trimEnd();
  return `${base}${base ? '\n\n' : ''}${block.replace(/^\n+/, '').trimEnd()}\n`;
}

/** Các @tag đứng đầu khối, theo thứ tự xuất hiện, không lặp. */
export function tagsOf(block: string): string[] {
  const out: string[] = [];
  for (const line of block.split('\n')) {
    const text = line.trim();
    if (text.startsWith('@')) {
      for (const tag of text.split(/\s+/)) if (tag.startsWith('@') && !out.includes(tag)) out.push(tag);
      continue;
    }
    if (text) break;
  }
  return out;
}

/**
 * Viết lại dòng @tag ở đầu khối cho khớp danh sách đưa vào.
 *
 * Sửa tag bằng cách gõ thẳng vào Gherkin thì dễ gõ sai chỗ — đặt dưới tên kịch
 * bản là tag của kịch bản sau, không phải kịch bản này.
 */
export function withTags(block: string, tags: string[]): string {
  const lines = block.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i]!.trim().startsWith('@') || !lines[i]!.trim())) i += 1;
  const body = lines.slice(i).join('\n');
  return tags.length > 0 ? `${tags.join(' ')}\n${body}` : body;
}

/**
 * Tên file suy ra từ tiêu đề feature.
 *
 * Bỏ dấu tiếng Việt thay vì để nguyên: tên file có dấu vẫn tạo được trên máy
 * này nhưng là nguồn rắc rối ở mọi chỗ khác — git trên máy khác, CI chạy Linux,
 * và cả `--grep` trên dòng lệnh.
 */
export function featureFileName(title: string): string {
  const slug = String(title ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${slug}.feature` : '';
}

/**
 * Khung một file feature mới.
 *
 * Có Feature và Background ngay từ đầu: nối một kịch bản trần vào chuỗi rỗng ra
 * một file Gherkin không parse được.
 */
export function newFeatureContent(title: string): string {
  return `Feature: ${title}\n\n  Background:\n    Given I open the app\n`;
}

/** Tên các kịch bản có trong nội dung, theo thứ tự xuất hiện. */
export function scenarioNames(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split('\n')) {
    const match = line.trim().match(SCENARIO_LINE);
    if (match) out.push(match[1]!.trim());
  }
  return out;
}
