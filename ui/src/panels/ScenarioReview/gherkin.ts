/** Phần thuần của editor: dễ test, không phụ thuộc DOM hay React. */
export function formatGherkin(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const text = line.trim();
      if (!text) return '';
      if (text.startsWith('@') || /^Scenario(?: Outline)?:/i.test(text)) return `  ${text}`;
      if (/^(?:Given|When|Then|And|But)\b|^Examples:/i.test(text)) return `    ${text}`;
      if (text.startsWith('|')) return `      ${text}`;
      return line.trimEnd();
    })
    .join('\n');
}

export function featureFileName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `${slug}.feature` : '';
}

export function newFeatureContent(title: string): string {
  return `Feature: ${title}\n\n  Background:\n    Given I open the app\n`;
}

function bounds(lines: string[], name: string): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => {
    const hit = line.match(/^\s*Scenario(?: Outline)?:\s*(.+?)\s*$/i);
    return hit?.[1] === name;
  });
  if (start < 0) return undefined;
  const next = lines.slice(start + 1).findIndex((line) => /^\s*Scenario(?: Outline)?:/i.test(line));
  return { start, end: next < 0 ? lines.length : start + 1 + next };
}

export function extractScenario(content: string, name: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const found = bounds(lines, name);
  return found ? lines.slice(found.start, found.end).join('\n').trim() : '';
}

export function removeScenario(content: string, name: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const found = bounds(lines, name);
  if (!found) return content;
  const start = found.start > 0 && !lines[found.start - 1]?.trim() ? found.start - 1 : found.start;
  const result = [...lines.slice(0, start), ...lines.slice(found.end)];
  while (result.length > 1 && !result.at(-1)?.trim() && !result.at(-2)?.trim()) result.pop();
  return result.join('\n');
}

export function replaceScenario(content: string, name: string, block: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const found = bounds(lines, name);
  if (!found) return content;
  const next = block.trim().split('\n');
  if (lines[found.end]?.trim()) next.push('');
  return [...lines.slice(0, found.start), ...next, ...lines.slice(found.end)].join('\n');
}

export function appendScenario(content: string, block: string): string {
  const base = content.trimEnd();
  return `${base}${base ? '\n\n' : ''}${block.replace(/^\n+/, '').trimEnd()}\n`;
}

export function hasOneScenario(content: string): boolean {
  return content.match(/^\s*Scenario(?: Outline)?:/gim)?.length === 1;
}
