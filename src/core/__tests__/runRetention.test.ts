/**
 * Một lượt chạy dở dang không được coi là "bản chạy xanh để đối chiếu".
 *
 * `prune` giữ N lượt pass gần nhất mỗi nền tảng, và trước đây mọi trạng thái
 * không phải `failed`/`running` đều rơi vào nhánh đếm ấy — kể cả `interrupted`.
 * Trên máy thật, ba lượt android bị Ctrl-C ăn hết hạn mức ba lượt pass, và lượt
 * pass duy nhất còn lại — một lượt Device Farm — bị xoá mất report, ảnh, video.
 * Đó là thứ đắt nhất trong thư mục: phút thiết bị đã trả bằng tiền, và AWS chỉ
 * giữ bản gốc khoảng 30 ngày.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { prune, writeRunMeta, type RunMeta } from '../runstore.js';

const DAY = 86_400_000;

function meta(over: Partial<RunMeta> & Pick<RunMeta, 'id' | 'status'>): RunMeta {
  return {
    platform: 'android',
    kind: 'run',
    startedAt: new Date().toISOString(),
    ...over,
  } as RunMeta;
}

async function store(metas: RunMeta[]): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), 'tp-runs-'));
  for (const m of metas) await writeRunMeta(path.join(root, m.id), m);
  return root;
}

const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

describe('prune — cái gì sống sót trong runs/', () => {
  it('lượt dở dang không ăn vào hạn mức lượt pass', async () => {
    const root = await store([
      meta({ id: 'x1', status: 'interrupted', startedAt: ago(0) }),
      meta({ id: 'x2', status: 'interrupted', startedAt: ago(1) }),
      meta({ id: 'x3', status: 'interrupted', startedAt: ago(2) }),
      meta({ id: 'farm-pass', status: 'passed', kind: 'farm', startedAt: ago(3) }),
    ]);
    const deleted = await prune(root, { keepFailedDays: 30, keepPassedPerPlatform: 3 });
    assert.deepEqual(deleted, [], 'không được xoá gì ở đây');
    assert.ok(existsSync(path.join(root, 'farm-pass')), 'lượt farm pass phải còn');
  });

  it('lượt dở dang vẫn hết hạn theo đồng hồ của lượt fail', async () => {
    const root = await store([
      meta({ id: 'cu', status: 'interrupted', startedAt: ago(45) }),
      meta({ id: 'moi', status: 'interrupted', startedAt: ago(2) }),
    ]);
    const deleted = await prune(root, { keepFailedDays: 30, keepPassedPerPlatform: 3 });
    assert.deepEqual(deleted, ['cu']);
    assert.ok(existsSync(path.join(root, 'moi')));
  });

  it('vẫn cắt đúng khi thừa lượt pass thật', async () => {
    const root = await store([
      meta({ id: 'p1', status: 'passed', startedAt: ago(1) }),
      meta({ id: 'p2', status: 'passed', startedAt: ago(2) }),
      meta({ id: 'p3', status: 'passed', startedAt: ago(3) }),
      meta({ id: 'p4', status: 'passed', startedAt: ago(4) }),
    ]);
    assert.deepEqual(await prune(root, { keepFailedDays: 30, keepPassedPerPlatform: 3 }), ['p4']);
  });

  /** Hạn mức đếm riêng từng nền tảng, nên android không được đẩy ios ra. */
  it('mỗi nền tảng một hạn mức', async () => {
    const root = await store([
      meta({ id: 'a1', status: 'passed', startedAt: ago(1) }),
      meta({ id: 'i1', status: 'passed', platform: 'ios', startedAt: ago(2) }),
    ]);
    assert.deepEqual(await prune(root, { keepFailedDays: 30, keepPassedPerPlatform: 1 }), []);
  });
});
