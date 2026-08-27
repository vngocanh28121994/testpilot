/**
 * Read the number out of what a screen displays.
 *
 * Shared because three places need to agree on it: the executor comparing a
 * value it read back, the generated page objects doing the same, and the step
 * vocabulary parsing the figure a scenario wrote. Two independent copies had
 * already drifted apart in this file's history, and a scenario that means
 * "1,000" must not depend on which layer is reading it.
 */
export function parseDisplayedNumber(text: string): number {
  const token = text.match(/-?\d[\d.,\s]*/u)?.[0]?.replace(/\s+/g, '');
  if (!token) throw new Error(`Không tìm thấy giá trị số trong "${text}".`);
  let normalized = token;
  if (token.includes(',') && token.includes('.')) {
    // Whichever separator comes last is the decimal point: "1.234,56" is
    // European and "1,234.56" is not, and the app renders both depending on
    // locale.
    const decimal = token.lastIndexOf(',') > token.lastIndexOf('.') ? ',' : '.';
    normalized = token
      .replace(decimal === ',' ? /\./g : /,/g, '')
      .replace(decimal, '.');
  } else if (/^-?\d{1,3}(?:[.,]\d{3})+$/u.test(token)) {
    // Groups of exactly three: thousands separators, not a decimal.
    normalized = token.replace(/[.,]/g, '');
  } else {
    normalized = token.replace(',', '.');
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error(`Giá trị "${text}" không phải số hợp lệ.`);
  return value;
}
