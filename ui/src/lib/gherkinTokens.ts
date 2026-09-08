/**
 * Tách một dòng Gherkin thành các mảnh để tô màu.
 *
 * Thuần tuý và không đụng tới DOM: lớp tô màu là một <pre> nằm dưới textarea,
 * nên mỗi mảnh phải giữ nguyên từng ký tự — kể cả khoảng trắng. Ghép các
 * `text` lại phải ra đúng dòng ban đầu, nếu không chữ tô màu sẽ lệch khỏi chữ
 * người dùng đang gõ. Đó là điều kiện được một test canh giữ.
 */

export type TokenKind =
  | 'heading' // Feature:, Scenario:, Background:, Examples:
  | 'step' // Given, When, Then, And, But
  | 'tag' // @smoke
  | 'string' // "…"
  | 'param' // <tên>
  | 'comment' // # …
  | 'table' // |
  | 'number'
  | 'text';

export interface Token {
  text: string;
  kind: TokenKind;
}

/** Từ khoá mở đầu một khối. Tiếng Anh, vì bộ phân tích Gherkin đọc tiếng Anh. */
const HEADING = /^(\s*)(Feature|Rule|Background|Scenario Outline|Scenario Template|Scenario|Examples|Scenarios)(\s*:)/;
/** Từ khoá mở đầu một bước. `*` là dạng viết tắt hợp lệ của Gherkin. */
const STEP = /^(\s*)(Given|When|Then|And|But|\*)(\s+|$)/;

/**
 * Trong phần thân một bước: chuỗi trong nháy kép, tham số trong ngoặc nhọn, số.
 * Thứ tự các nhánh là có chủ ý — chuỗi đứng trước để một số nằm trong nháy kép
 * vẫn được tính là chuỗi.
 */
const INLINE = /("[^"]*"|<[^>]*>|\b\d+(?:[.,]\d+)*\b)/g;

function inlineTokens(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) out.push({ text: text.slice(last, at), kind: 'text' });
    const value = match[0];
    out.push({
      text: value,
      kind: value.startsWith('"') ? 'string' : value.startsWith('<') ? 'param' : 'number',
    });
    last = at + value.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'text' });
  return out;
}

export function tokenizeLine(line: string): Token[] {
  if (line === '') return [];

  const trimmed = line.trimStart();

  // Chú thích ăn cả dòng, nên xét trước mọi thứ khác.
  if (trimmed.startsWith('#')) return [{ text: line, kind: 'comment' }];

  // Dòng tag: mọi từ bắt đầu bằng @ đều là tag, khoảng trắng giữ nguyên.
  if (trimmed.startsWith('@')) {
    return line
      .split(/(\s+)/)
      .filter((part) => part !== '')
      .map((part) => ({ text: part, kind: part.startsWith('@') ? 'tag' : 'text' }) as Token);
  }

  // Dòng bảng của Examples.
  if (trimmed.startsWith('|')) {
    return line
      .split(/(\|)/)
      .filter((part) => part !== '')
      .map((part) => ({ text: part, kind: part === '|' ? 'table' : 'text' }) as Token);
  }

  const heading = HEADING.exec(line);
  if (heading) {
    const [, indent, word, colon] = heading;
    return [
      ...(indent ? [{ text: indent, kind: 'text' as const }] : []),
      { text: `${word}${colon}`, kind: 'heading' },
      ...inlineTokens(line.slice(heading[0].length)),
    ];
  }

  const step = STEP.exec(line);
  if (step) {
    const [, indent, word, space] = step;
    return [
      ...(indent ? [{ text: indent, kind: 'text' as const }] : []),
      { text: word!, kind: 'step' },
      ...(space ? [{ text: space, kind: 'text' as const }] : []),
      ...inlineTokens(line.slice(step[0].length)),
    ];
  }

  return inlineTokens(line);
}
