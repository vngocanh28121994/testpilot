/**
 * Gán lại tag LOẠI HÀNH VI cho các feature đã có.
 *
 * KHÔNG chạy lại applyGeneratedTagPolicy trên file cũ. Ba lý do, đều đã kiểm
 * chứng bằng chạy thử trên chính repo này:
 *
 *  - Vô tác dụng. Chính sách nay ưu tiên loại "do model gán", mà tag đang nằm
 *    trong file cũ chính là kết quả dò từ khoá lỗi trước đây — nó được đọc như
 *    câu trả lời của model và được giữ nguyên. Chạy lại chỉ đóng dấu cho cái sai.
 *  - Phá độ ưu tiên. 4/7 feature không có bản ghi coverage, nên không map được
 *    yêu cầu nào và mọi kịch bản rơi xuống @p2.
 *  - Xoá tag tự đặt. Chính sách chỉ giữ lại platform và operation, nên @login,
 *    @search, @my-asset-bond biến mất — và lệnh chạy theo tag đó hỏng theo.
 *
 * Nên bước này chỉ làm đúng một việc: hỏi model phân loại từng kịch bản, rồi
 * thay đúng MỘT tag loại. Mọi tag khác giữ nguyên tại chỗ.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { completeJson } from '../llm/client.js';
import { firstJsonObject } from '../llm/json.js';
import { loadConfig } from '../config.js';
import { adoptStoredApiKeys } from '../core/secrets.js';
import { ScenarioReviewStore } from '../core/scenarioReview.js';
import { scenarioBlocks } from '../core/scenarioReview.js';

const TYPES = ['@positive', '@negative', '@boundary', '@business-rule'] as const;
type Behaviour = (typeof TYPES)[number];

interface Row {
  file: string;
  name: string;
  before: string | undefined;
  after?: Behaviour;
  block: string;
}

/** Dòng tag ngay trên một scenario, kèm chỉ số để ghi lại đúng chỗ. */
function tagLinesOf(lines: string[], scenarioIndex: number): { from: number; tags: string[] } {
  let from = scenarioIndex;
  const tags: string[] = [];
  while (from > 0 && /^\s*@\S/.test(lines[from - 1] ?? '')) {
    from -= 1;
    tags.unshift(...(lines[from] ?? '').trim().split(/\s+/).filter(Boolean));
  }
  return { from, tags };
}

function scenarioIndexes(lines: string[]): number[] {
  return lines
    .map((line, index) => (/^\s*Scenario(?: Outline)?:/i.test(line) ? index : -1))
    .filter((index) => index >= 0);
}

function collect(file: string, content: string): Row[] {
  const lines = content.split('\n');
  const blocks = new Map(scenarioBlocks(content).map((b) => [b.name, b.content]));
  return scenarioIndexes(lines).map((index) => {
    const name = (lines[index] ?? '').replace(/^\s*Scenario(?: Outline)?:\s*/i, '').trim();
    const { tags } = tagLinesOf(lines, index);
    return {
      file,
      name,
      before: tags.find((tag) => (TYPES as readonly string[]).includes(tag)),
      block: blocks.get(name) ?? '',
    };
  });
}

async function classify(rows: Row[], model: string): Promise<Map<string, Behaviour>> {
  const system =
    'Bạn phân loại testcase Gherkin. Chỉ trả JSON, không giải thích.\n' +
    '@positive: luồng hợp lệ, kết quả thành công.\n' +
    '@negative: dữ liệu/trạng thái không hợp lệ, hệ thống từ chối hoặc báo lỗi.\n' +
    '@boundary: giới hạn, ngưỡng, tối đa/tối thiểu, giá trị biên.\n' +
    '@business-rule: quy tắc nghiệp vụ — lọc trùng, loại trừ, tự động, phân quyền, điều kiện.\n' +
    'Khi một kịch bản vừa là quy tắc nghiệp vụ vừa có con số giới hạn, chọn theo điều ' +
    'mà kịch bản đang thực sự kiểm tra.';
  const user =
    'Phân loại từng kịch bản dưới đây. Trả về JSON dạng ' +
    '{"items":[{"key":"<key>","type":"@..."}]} với key nguyên văn như đã cho.\n\n' +
    rows
      .map((row, index) => `### key=${index}\n${row.block}`)
      .join('\n\n');

  const raw = await completeJson({ model, system, user, maxTokens: 8_000, temperature: 0 });
  const parsed = JSON.parse(firstJsonObject(raw)) as {
    items?: Array<{ key?: unknown; type?: unknown }>;
  };
  const out = new Map<string, Behaviour>();
  for (const item of parsed.items ?? []) {
    const index = Number(item.key);
    const type = String(item.type);
    const row = rows[index];
    if (!row || !(TYPES as readonly string[]).includes(type)) continue;
    out.set(`${row.file}::${row.name}`, type as Behaviour);
  }
  return out;
}

/** Ghi đúng một tag loại vào khối tag của scenario, giữ nguyên mọi tag khác. */
function rewrite(content: string, decisions: Map<string, Behaviour>, file: string): string {
  const lines = content.split('\n');
  for (const index of scenarioIndexes(lines).reverse()) {
    const name = (lines[index] ?? '').replace(/^\s*Scenario(?: Outline)?:\s*/i, '').trim();
    const next = decisions.get(`${file}::${name}`);
    if (!next) continue;
    const { from, tags } = tagLinesOf(lines, index);
    const kept = tags.filter((tag) => !(TYPES as readonly string[]).includes(tag));
    const indent = (lines[index] ?? '').match(/^\s*/)?.[0] ?? '  ';
    const rebuilt = `${indent}${[...kept, next].join(' ')}`;
    lines.splice(from, index - from, rebuilt);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  // Khoá API sống trong secrets store, không phải biến môi trường — giống
  // đường UI và generator CLI, để cách khởi động không đổi được nhà cung cấp.
  await adoptStoredApiKeys();
  const cfg = await loadConfig(process.env.TESTPILOT_CONFIG ?? 'testpilot.config.json');
  const dir = cfg.paths.features;
  const files = (await readdir(dir)).filter((name) => name.endsWith('.feature')).sort();

  const rows: Row[] = [];
  const contents = new Map<string, string>();
  for (const file of files) {
    const content = readFileSync(path.join(dir, file), 'utf8');
    contents.set(file, content);
    rows.push(...collect(file, content));
  }

  console.log(`${rows.length} kịch bản trong ${files.length} file. Đang hỏi ${cfg.llm.model}…\n`);
  const decisions = await classify(rows, cfg.llm.model);

  let changed = 0;
  let currentFile = '';
  for (const row of rows) {
    const after = decisions.get(`${row.file}::${row.name}`);
    if (row.file !== currentFile) {
      currentFile = row.file;
      console.log(`\n=== ${row.file} ===`);
    }
    const differs = after && after !== row.before;
    if (differs) changed += 1;
    console.log(
      `${differs ? '!' : ' '} ${row.name.slice(0, 50).padEnd(50)} ` +
      `${(row.before ?? '(chưa có)').padEnd(15)} → ${after ?? '(model không trả lời)'}`,
    );
  }
  console.log(`\n${changed}/${rows.length} kịch bản đổi loại.`);

  if (!write) {
    console.log('\nChạy thử — chưa ghi gì. Thêm --write để ghi.');
    return;
  }

  // Tag không phải hành vi của kịch bản: các bước test không đổi một chữ, nên
  // quyết định duyệt trước đó vẫn còn giá trị. Cập nhật hash tại chỗ và giữ
  // nguyên status, thay vì để syncFile() đẩy tất cả về pending.
  const reviews = await ScenarioReviewStore.load(cfg.paths.scenarioReviewDb);
  let carried = 0;
  for (const file of files) {
    const before = contents.get(file)!;
    const after = rewrite(before, decisions, file);
    if (after === before) continue;
    writeFileSync(path.join(dir, file), after, 'utf8');
    for (const block of scenarioBlocks(after)) {
      if (reviews.retagged(file, block.name, block.contentHash)) carried += 1;
    }
  }
  await reviews.save();
  console.log(`Đã ghi. Giữ nguyên trạng thái duyệt cho ${carried} kịch bản.`);
}

void main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
