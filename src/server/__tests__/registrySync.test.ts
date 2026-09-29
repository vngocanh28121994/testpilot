/**
 * Workflow sinh kịch bản ghi element mới ra ĐĨA; màn duyệt ở chế độ server đọc
 * registry trong POSTGRES. Đo thật: đĩa 146 element, Postgres 136 — kịch bản
 * dùng "Xin chào" (chỉ có trên đĩa) → `Unknown element` → "0 kịch bản".
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { ElementRegistry } from '../../core/types.js';
import { pullToDisk, pushNew } from '../registrySync.js';

const el = (id: string, label = id) => ({ id, label, screen: 'login', candidates: {} }) as never;

function fakeRepo(data: ElementRegistry) {
  let revision = 1;
  const writes: ElementRegistry[] = [];
  return {
    writes,
    read: async () => ({ data: structuredClone(data), revision: String(revision) }),
    write: async (next: ElementRegistry, base?: string) => {
      if (base !== String(revision)) throw new Error('conflict');
      data = next;
      revision += 1;
      writes.push(next);
      return { data: next, revision: String(revision) };
    },
    current: () => data,
  };
}

async function disk(content: ElementRegistry): Promise<string> {
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'regsync-')), 'elements.json');
  await writeFile(file, JSON.stringify(content));
  return file;
}

describe('pushNew — element vừa sinh lên registry dùng chung', () => {
  it('đẩy element và màn hình máy chủ chưa có', async () => {
    const repo = fakeRepo({ version: 1, screens: {}, elements: { a: el('a') } });
    const file = await disk({
      version: 1,
      screens: { home: { id: 'home', name: 'Trang chủ' } as never },
      elements: { a: el('a'), xinChao: el('xinChao', 'Xin chào') },
    });
    assert.deepEqual(await pushNew(repo, file), { elements: 1, screens: 1 });
    assert.ok(repo.current().elements.xinChao);
    assert.ok(repo.current().screens.home);
  });

  it('KHÔNG ghi đè bản trên máy chủ — nó có thể vừa được sửa', async () => {
    const repo = fakeRepo({ version: 1, screens: {}, elements: { a: el('a', 'bản mới trên máy chủ') } });
    const file = await disk({ version: 1, screens: {}, elements: { a: el('a', 'bản cũ trên đĩa') } });
    assert.deepEqual(await pushNew(repo, file), { elements: 0, screens: 0 });
    assert.equal(repo.writes.length, 0);
    assert.equal((repo.current().elements.a as { label: string }).label, 'bản mới trên máy chủ');
  });
});

describe('pullToDisk — pipeline thấy đủ element trước khi sinh', () => {
  it('máy chủ thắng khi trùng id, element chỉ có trên đĩa được giữ', async () => {
    const repo = fakeRepo({ version: 1, screens: {}, elements: { a: el('a', 'máy chủ') } });
    const file = await disk({ version: 1, screens: {}, elements: { a: el('a', 'đĩa'), riengDia: el('riengDia') } });
    await pullToDisk(repo, file);
    const after = JSON.parse(await readFile(file, 'utf8')) as ElementRegistry;
    assert.equal((after.elements.a as { label: string }).label, 'máy chủ');
    assert.ok(after.elements.riengDia);
  });
});
