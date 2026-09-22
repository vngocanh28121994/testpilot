/**
 * `testpilot registry pull|push` — đưa registry qua lại giữa server và đĩa.
 *
 *   npm run registry:pull                  # kéo bản server về file local
 *   npm run registry:push                  # đẩy file local lên thành đề xuất
 *   npm run registry:push -- --dry-run     # chỉ xem mình sắp đề xuất gì
 *
 * Vì sao cần: khi registry chuyển vào Postgres của server, người sửa element
 * bằng editor mất đường về. Giao diện web sửa được, nhưng không sửa được
 * hai trăm element trong một lần, và không xem được diff trước khi gửi —
 * hai việc mà một file trên đĩa làm tốt hơn mọi form.
 *
 * `push` KHÔNG ghi thẳng, kể cả khi bạn là admin: nó tạo đề xuất. Xem
 * `src/server/proposals/store.ts` để biết vì sao.
 *
 * Con số quan trọng nhất trong file này là `revision` kéo về lúc `pull`: nó
 * được ghi cạnh registry và gửi lại lúc `push`, nên server biết bạn đang sửa
 * trên bản nào. Thiếu nó thì `push` là ghi đè mù — và cái mất đi là việc của
 * người khác, không phải của bạn.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import type { ElementRegistry } from '../core/types.js';

/** Bản ghi cạnh registry: ta kéo về bản nào. Không nằm TRONG registry vì nó
 *  không phải dữ liệu của tổ chức — nó là sổ tay của chiếc máy này. */
interface PullMark {
  revision: string | null;
  serverUrl: string;
  pulledAt: string;
}

interface Summary { added: string[]; removed: string[]; changed: string[] }

function markPath(registryFile: string): string {
  return path.join(path.dirname(registryFile), '.registry-pull.json');
}

function serverUrl(): string {
  const url = process.env.TESTPILOT_SERVER?.trim();
  if (!url) {
    throw new Error(
      'Thiếu TESTPILOT_SERVER. Lệnh này nói chuyện với control plane, '
      + 'nên nó cần biết nối vào đâu — ví dụ TESTPILOT_SERVER=http://localhost:4300.',
    );
  }
  return url.replace(/\/+$/, '');
}

/**
 * Header xác thực.
 *
 * Ở chế độ embedded server không hỏi gì, nên không có biến nào cũng chạy
 * được — và đó là trường hợp thường gặp nhất lúc thử. Ở chế độ server thì
 * cần cookie phiên, lấy từ trình duyệt đã đăng nhập.
 */
function authHeaders(): Record<string, string> {
  const session = process.env.TESTPILOT_SESSION?.trim();
  return session ? { cookie: `testpilot_session=${session}` } : {};
}

async function call<T>(
  method: string, route: string, body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${serverUrl()}${route}`, {
    method,
    headers: {
      ...authHeaders(),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Một trang HTML ở đây thường nghĩa là ta gọi nhầm cổng — nói thẳng thế
    // thay vì ném ra một lỗi parse mà người đọc phải tự đoán.
    throw new Error(`${route} trả về thứ không phải JSON (${res.status}): ${text.slice(0, 120)}`);
  }
  return { status: res.status, data: data as T };
}

function describe(summary: Summary): string {
  const parts: string[] = [];
  if (summary.added.length) parts.push(`+${summary.added.length} mới`);
  if (summary.changed.length) parts.push(`~${summary.changed.length} sửa`);
  if (summary.removed.length) parts.push(`-${summary.removed.length} bỏ`);
  return parts.length ? parts.join(', ') : 'không có gì khác';
}

function detail(summary: Summary): string[] {
  return [
    ...summary.added.map((id) => `  + ${id}`),
    ...summary.changed.map((id) => `  ~ ${id}`),
    ...summary.removed.map((id) => `  - ${id}`),
  ];
}

async function pull(registryFile: string): Promise<void> {
  const { status, data } = await call<{ registry: ElementRegistry; revision: string | null }>(
    'GET', '/api/registry',
  );
  if (status !== 200) throw new Error(`Server trả ${status}: ${JSON.stringify(data)}`);

  await fs.mkdir(path.dirname(registryFile), { recursive: true });
  await fs.writeFile(registryFile, `${JSON.stringify(data.registry, null, 2)}\n`, 'utf8');
  const mark: PullMark = {
    revision: data.revision,
    serverUrl: serverUrl(),
    pulledAt: new Date().toISOString(),
  };
  await fs.writeFile(markPath(registryFile), `${JSON.stringify(mark, null, 2)}\n`, 'utf8');

  const count = Object.keys(data.registry.elements ?? {}).length;
  console.log(`[registry] kéo về ${count} element, revision ${data.revision ?? 'chưa có'}`);
  console.log(`[registry] ghi vào ${registryFile}`);
}

async function push(registryFile: string, dryRun: boolean): Promise<void> {
  const registry = JSON.parse(await fs.readFile(registryFile, 'utf8')) as ElementRegistry;
  let mark: PullMark | undefined;
  try {
    mark = JSON.parse(await fs.readFile(markPath(registryFile), 'utf8')) as PullMark;
  } catch {
    // Chưa pull bao giờ. Vẫn đẩy được, chỉ là server không có gì để đối chiếu
    // — nên nói rõ chuyện đó ra chứ không im lặng đẩy.
    console.warn('[registry] chưa pull lần nào, nên lần đẩy này không đối chiếu được bản nền.');
  }

  if (dryRun) {
    const { data } = await call<{ registry: ElementRegistry }>('GET', '/api/registry');
    const { summarise } = await import('../server/proposals/store.js');
    const summary = summarise(data.registry, registry);
    console.log(`[registry] sẽ đề xuất: ${describe(summary)}`);
    for (const line of detail(summary)) console.log(line);
    return;
  }

  const { status, data } = await call<{
    proposal?: { id: string } | null; summary?: Summary;
    error?: string; diff?: Summary; currentRevision?: string;
  }>('POST', '/api/registry/push', {
    registry,
    ...(mark?.revision ? { baseRevision: mark.revision } : {}),
  });

  if (status === 409) {
    // Xung đột IN RA DIFF, không ghi đè. Đây là điều kiện nghiệm thu của
    // P4.4b, và cũng là lý do cả lệnh này tồn tại ở dạng đề xuất.
    console.error(`[registry] ${data.error}`);
    const diff = data.diff ?? { added: [], removed: [], changed: [] };
    if (detail(diff).length === 0) {
      // Revision lệch mà không element nào khác: ai đó đã ghi một bản có cùng
      // nội dung element nhưng khác ở chỗ khác — hoặc chính bạn vừa sửa file
      // mà server đang đọc chung. Nói ra thay vì in một danh sách rỗng.
      console.error('[registry] lệch phiên bản nhưng không element nào khác nhau.');
    } else {
      console.error('[registry] bản trên server khác bản bạn đẩy ở:');
      for (const line of detail(diff)) console.error(line);
    }
    console.error('[registry] chạy `npm run registry:pull`, gộp lại, rồi đẩy tiếp.');
    process.exitCode = 3;
    return;
  }
  if (status >= 400) throw new Error(`Server trả ${status}: ${data.error ?? JSON.stringify(data)}`);

  if (!data.proposal) {
    console.log('[registry] bản local giống hệt bản server, không tạo đề xuất.');
    return;
  }
  console.log(`[registry] đã gửi đề xuất ${data.proposal.id}: ${describe(data.summary!)}`);
  for (const line of detail(data.summary!)) console.log(line);
  console.log('[registry] người có vai maintainer duyệt ở màn Healing.');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const cfg = await loadConfig(
    argv.includes('--config') ? argv[argv.indexOf('--config') + 1]! : process.env.TESTPILOT_CONFIG,
  );
  const registryFile = cfg.paths.registry;

  if (command === 'pull') return pull(registryFile);
  if (command === 'push') return push(registryFile, argv.includes('--dry-run'));
  throw new Error('Dùng: registry pull | registry push [--dry-run]');
}

main().catch((err: Error) => {
  console.error(`[registry] ${err.message}`);
  process.exit(1);
});
