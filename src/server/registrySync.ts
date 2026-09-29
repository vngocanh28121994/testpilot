/**
 * Giữ registry trên đĩa và registry của máy chủ (Postgres) khớp nhau quanh
 * bước SINH kịch bản.
 *
 * Pipeline sinh (`runGenPipeline`) đọc và ghi `registry/elements.json` trên
 * đĩa — đúng ở chế độ local, nơi file ấy LÀ registry. Ở chế độ server thì
 * registry dùng chung nằm trong Postgres, và mọi thứ khác (màn Kịch bản, snapshot
 * gửi runner) đọc từ đó. Hai nơi lệch nhau: đo ngày 2026-09-27, đĩa có 146
 * element, Postgres 136 — workflow "Đăng nhập TCInvest" sinh kịch bản dùng
 * element "Xin chào" chỉ có trên đĩa, nên máy chủ đọc file ấy ra `Unknown
 * element` và màn duyệt hiện "0 kịch bản" cho tám kịch bản đang chờ duyệt.
 *
 * Hai bước, đặt hai bên pipeline:
 *
 * - `pullToDisk` TRƯỚC: đưa bản của máy chủ xuống đĩa, máy chủ thắng khi trùng
 *   id — pipeline thấy đủ element đã có và dùng lại, không sinh bản trùng.
 *   Element chỉ có trên đĩa được giữ nguyên: có thể là việc của lượt trước bản
 *   sửa này, và vứt đi là mất.
 * - `pushNew` SAU: đẩy lên những element và màn hình CHƯA có trên máy chủ. Không
 *   đụng cái đã có: bản trên máy chủ có thể vừa được sửa, và bản trên đĩa là
 *   bản cũ hơn.
 *
 * Ở chế độ local, repo là chính file ấy: hai bước thành không làm gì.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElementRegistry } from '../core/types.js';
import type { RegistryRepo } from './db/repo.js';

const EMPTY: ElementRegistry = { version: 1, screens: {}, elements: {} };

async function readDisk(file: string): Promise<ElementRegistry> {
  if (!existsSync(file)) return structuredClone(EMPTY);
  return JSON.parse(await readFile(file, 'utf8')) as ElementRegistry;
}

/** Máy chủ → đĩa, máy chủ thắng khi trùng id. Trả số mục đã đổi trên đĩa. */
export async function pullToDisk(repo: Pick<RegistryRepo, 'read'>, file: string): Promise<number> {
  const server = (await repo.read()).data;
  const disk = await readDisk(file);
  let changed = 0;
  for (const [id, element] of Object.entries(server.elements)) {
    if (JSON.stringify(disk.elements[id]) === JSON.stringify(element)) continue;
    disk.elements[id] = element;
    changed += 1;
  }
  for (const [id, screen] of Object.entries(server.screens)) {
    if (JSON.stringify(disk.screens[id]) === JSON.stringify(screen)) continue;
    disk.screens[id] = screen;
    changed += 1;
  }
  if (changed === 0) return 0;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(disk, null, 2) + '\n', 'utf8');
  return changed;
}

/**
 * Đĩa → máy chủ, CHỈ những mục máy chủ chưa có.
 *
 * Ghi bằng `write` kèm revision đã đọc: có ai ghi chen vào giữa thì đọc lại và
 * thử lại, thay vì ghi đè việc của họ.
 */
export async function pushNew(
  repo: Pick<RegistryRepo, 'read' | 'write'>,
  file: string,
  attempts = 3,
): Promise<{ elements: number; screens: number }> {
  const disk = await readDisk(file);
  for (let attempt = 1; ; attempt += 1) {
    const current = await repo.read();
    const next = structuredClone(current.data);
    let elements = 0;
    let screens = 0;
    for (const [id, element] of Object.entries(disk.elements)) {
      if (next.elements[id]) continue;
      next.elements[id] = element;
      elements += 1;
    }
    for (const [id, screen] of Object.entries(disk.screens)) {
      if (next.screens[id]) continue;
      next.screens[id] = screen;
      screens += 1;
    }
    if (elements === 0 && screens === 0) return { elements, screens };
    try {
      await repo.write(next, current.revision);
      return { elements, screens };
    } catch (err) {
      if (attempt >= attempts) throw err;
    }
  }
}
