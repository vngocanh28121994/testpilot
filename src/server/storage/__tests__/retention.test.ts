/**
 * Dọn artifact cũ, và thứ tự của hai thao tác xoá.
 *
 * Bài đáng giá nhất ở đây canh THỨ TỰ: xoá file trước, xoá dòng sau. Ngược lại
 * thì một lần hỏng giữa chừng để lại file mồ côi trong kho mà không dòng nào
 * trỏ tới — không ai biết nó tồn tại, và nó nằm đó trả tiền mãi mãi.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sweepArtifacts } from '../retention.js';
import type { ArtifactRepo, ArtifactRow } from '../artifactRepo.js';
import type { ArtifactStore } from '../artifacts.js';

function row(id: string, days: number, bytes = 1024): ArtifactRow {
  return {
    id,
    jobId: 'job-1',
    orgId: 'org-1',
    kind: 'report',
    storageKey: `org-1/job-1/${id}.html`,
    bytes,
    createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function harness(rows: ArtifactRow[], removeFails: string[] = []) {
  const events: string[] = [];
  const store = {
    put: async (key: string) => ({ key }),
    signedUrl: async () => '',
    signedPutUrl: async () => '',
    list: async () => [],
    get: async () => Buffer.alloc(0),
    remove: async (key: string) => {
      if (removeFails.some((bad) => key.includes(bad))) throw new Error('kho từ chối');
      events.push(`remove:${key}`);
    },
  } satisfies ArtifactStore;

  const forgotten: string[] = [];
  const repo: ArtifactRepo = {
    record: async () => 0,
    forJob: async () => [],
    olderThan: async (_orgId, cutoff) =>
      rows.filter((item) => Date.parse(item.createdAt) < cutoff.getTime()),
    forget: async (ids) => {
      events.push(`forget:${ids.length}`);
      forgotten.push(...ids);
      return ids.length;
    },
  };

  return { store, repo, events, forgotten };
}

describe('dọn artifact', () => {
  it('xoá file TRƯỚC rồi mới xoá dòng', async () => {
    const h = harness([row('a', 40)]);
    await sweepArtifacts({ store: h.store, repo: h.repo, orgId: 'org-1', keepDays: 30 });
    assert.deepEqual(h.events, ['remove:org-1/job-1/a.html', 'forget:1']);
  });

  it('chỉ đụng tới thứ quá hạn', async () => {
    const h = harness([row('cu', 40), row('moi', 3)]);
    const result = await sweepArtifacts({
      store: h.store, repo: h.repo, orgId: 'org-1', keepDays: 30,
    });
    assert.equal(result.removed, 1);
    assert.deepEqual(h.forgotten, ['cu']);
  });

  it('một khoá không xoá được không chặn những khoá còn lại', async () => {
    const h = harness([row('a', 40), row('hong', 40), row('c', 40)], ['hong']);
    const result = await sweepArtifacts({
      store: h.store, repo: h.repo, orgId: 'org-1', keepDays: 30,
    });

    assert.equal(result.removed, 2);
    assert.equal(result.failed, 1);
    // Dòng của khoá hỏng Ở LẠI: lần dọn sau gặp lại nó, và lúc ấy kho có thể
    // đã bình thường trở lại.
    assert.deepEqual(h.forgotten.sort(), ['a', 'c']);
  });

  it('không có gì quá hạn thì không gọi `forget`', async () => {
    const h = harness([row('moi', 1)]);
    const result = await sweepArtifacts({
      store: h.store, repo: h.repo, orgId: 'org-1', keepDays: 30,
    });
    assert.equal(result.removed, 0);
    assert.deepEqual(h.events, [], 'đừng gọi kho khi không có việc gì');
  });

  it('cộng dung lượng đã giải phóng, để dòng log nói được con số', async () => {
    const h = harness([row('a', 40, 2048), row('b', 40, 1024)]);
    const result = await sweepArtifacts({
      store: h.store, repo: h.repo, orgId: 'org-1', keepDays: 30,
    });
    assert.equal(result.bytes, 3072);
  });
});
