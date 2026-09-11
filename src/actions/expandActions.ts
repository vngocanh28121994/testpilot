import type { ActionRegistry } from './ActionRegistry.js';

/** Một dòng bị thay, kèm lý do — đủ để người duyệt đọc mà không mở mã nguồn. */
export interface ExpansionChange {
  line: number;
  from: string;
  to: string;
  reason: string;
}

export interface AppliedAction {
  id: string;
  label: string;
  line: number;
}

/**
 * Nở các action đã duyệt thành những câu thuộc tập mẫu chuẩn.
 *
 * Tách khỏi server để CẢ HAI đường cùng gọi đúng một hàm. Trước đây nó chỉ nằm
 * trong đường "Chuẩn hoá": gõ một câu macro đã duyệt rồi bấm thẳng "Lưu" thì
 * câu đó không nở, bản nháp biên dịch hỏng, và vòng tự sửa của AI đi viết lại
 * nó thành một câu khác — action đã duyệt coi như không tồn tại, tuỳ theo người
 * dùng bấm nút nào trước.
 */
export function expandApprovedActions(
  content: string,
  actions: ActionRegistry,
): {
  content: string;
  changes: ExpansionChange[];
  applied: AppliedAction[];
} {
  const changes: ExpansionChange[] = [];
  const applied: AppliedAction[] = [];
  const output: string[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(/^(\s*)(Given|When|Then|And|But)\s+(.+)$/i);
    if (!match) {
      output.push(line);
      continue;
    }
    const expanded = actions.expand(match[3]!.trim());
    if (!expanded) {
      output.push(line);
      continue;
    }
    const indent = match[1] ?? '';
    const keyword = match[2] ?? 'And';
    expanded.steps.forEach((step, stepIndex) => {
      output.push(`${indent}${stepIndex === 0 ? keyword : 'And'} ${step}`);
    });
    changes.push({
      line: index + 1,
      from: match[3]!.trim(),
      to: expanded.steps.join(' → '),
      reason: `Áp dụng action đã duyệt: ${expanded.action.label}`,
    });
    applied.push({ id: expanded.action.id, label: expanded.action.label, line: index + 1 });
  }
  return { content: output.join('\n'), changes, applied };
}
