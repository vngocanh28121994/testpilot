/**
 * Repo phải nói đúng câu mà code hôm nay đang nói.
 *
 * Đây là lưới an toàn của cả P1: route sẽ lần lượt chuyển từ gọi thẳng
 * `Registry.load()` sang gọi repo, và mỗi lần chuyển như thế chỉ an toàn nếu
 * hai đường cho ra cùng một kết quả. So sánh trực tiếp hai đường trong cùng
 * một bài test là cách duy nhất nói được điều đó — đọc kỹ code rồi tin là
 * giống nhau thì không phải bằng chứng.
 *
 * Khi P2.4 thêm bản Postgres, chính bộ test này chạy lại với hiện thực kia.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Registry } from '../../../core/registry.js';
import { History } from '../../../core/history.js';
import type { ElementRegistry } from '../../../core/types.js';
import { listRuns, writeRunMeta } from '../../../core/runstore.js';
import { FileJobRepo, FileRegistryRepo, FileRunRepo } from '../fileRepo.js';
import { RevisionConflictError } from '../repo.js';

async function workspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'testpilot-repo-'));
}

function registryWith(id: string, label: string): ElementRegistry {
  return {
    version: 1,
    screens: {},
    elements: {
      [id]: {
        id,
        label,
        screen: 'p',
        candidates: { web: [{ strategy: 'testId', value: id, weight: 0.9, origin: 'authored' }] },
      },
    },
  } as unknown as ElementRegistry;
}

describe('FileRegistryRepo ngang bằng Registry', () => {
  it('đọc qua repo cho đúng thứ Registry.load() cho', async () => {
    const dir = await workspace();
    const file = path.join(dir, 'elements.json');
    await writeFile(file, JSON.stringify(registryWith('p.more', 'Thêm mã')), 'utf8');

    const direct = await Registry.load(file);
    const viaRepo = await new FileRegistryRepo(file).read();

    assert.deepEqual(viaRepo.data, direct.raw);
    assert.ok(viaRepo.revision, 'đọc phải kèm phiên bản, nếu không lần ghi sau không có gì đối chiếu');
  });

  it('ghi qua repo cho ra file mà Registry.load() đọc lại được', async () => {
    const dir = await workspace();
    const file = path.join(dir, 'elements.json');
    const repo = new FileRegistryRepo(file);

    const written = await repo.write(registryWith('p.remove', 'Xoá'));
    const reread = await Registry.load(file);

    assert.equal(reread.element('p.remove').label, 'Xoá');
    assert.equal(written.revision, (await repo.read()).revision);
  });

  /** Chưa có file thì ghi lần đầu, không có gì để đối chiếu và không được chặn. */
  it('ghi lần đầu vào file chưa tồn tại', async () => {
    const dir = await workspace();
    const repo = new FileRegistryRepo(path.join(dir, 'elements.json'));

    assert.equal((await repo.read()).revision, undefined);
    const written = await repo.write(registryWith('p.first', 'Đầu tiên'));
    assert.ok(written.revision);
  });

  /**
   * Phần đắt nhất của nhiều người dùng, và hôm nay nó im lặng: hai người sửa
   * cùng một element thì bản sau thắng và bản trước biến mất không dấu vết.
   */
  it('ghi dựa trên bản cũ thì bị từ chối, không ghi đè im lặng', async () => {
    const dir = await workspace();
    const file = path.join(dir, 'elements.json');
    const repo = new FileRegistryRepo(file);
    const first = await repo.write(registryWith('p.a', 'A'));

    // Người thứ hai ghi trong lúc người thứ nhất còn đang sửa.
    await repo.write(registryWith('p.b', 'B'));

    await assert.rejects(
      () => repo.write(registryWith('p.c', 'C'), first.revision),
      (err: Error) => {
        assert.ok(err instanceof RevisionConflictError);
        assert.match(err.message, /đã đổi ở nơi khác/);
        return true;
      },
    );

    // Và bản của người thứ hai vẫn còn nguyên.
    assert.equal((await Registry.load(file)).element('p.b').label, 'B');
  });

  it('ghi đúng phiên bản đang có thì qua', async () => {
    const dir = await workspace();
    const repo = new FileRegistryRepo(path.join(dir, 'elements.json'));
    const first = await repo.write(registryWith('p.a', 'A'));
    const second = await repo.write(registryWith('p.b', 'B'), first.revision);
    assert.notEqual(second.revision, first.revision);
  });

  /**
   * `merge` phải đi qua `Registry.mergeFrom()` chứ không tự cộng: phép gộp có
   * luật riêng cho từng loại trường, và một bản sao thứ hai sẽ lệch dần.
   */
  it('gộp delta giữ lại element cũ và cộng dồn bộ đếm', async () => {
    const dir = await workspace();
    const file = path.join(dir, 'elements.json');
    const base = registryWith('p.a', 'A');
    (base.elements['p.a'] as { health?: unknown }).health = {
      resolutions: 2, heals: 1, winners: { 'testId=p.a': 2 },
    };
    await writeFile(file, JSON.stringify(base), 'utf8');

    const delta = registryWith('p.b', 'B');
    (delta.elements['p.b'] as { health?: unknown }).health = {
      resolutions: 3, heals: 0, winners: { 'testId=p.b': 3 },
    };
    const merged = await new FileRegistryRepo(file).merge(delta);

    assert.ok(merged.data.elements['p.a'], 'gộp không được làm mất element đang có');
    assert.ok(merged.data.elements['p.b'], 'gộp phải thêm element mới học được');
    assert.equal(merged.data.elements['p.a']?.health?.resolutions, 2);
    assert.equal(merged.data.elements['p.b']?.health?.resolutions, 3);
  });

  it('file trên đĩa sau khi gộp vẫn là JSON hợp lệ có xuống dòng cuối', async () => {
    const dir = await workspace();
    const file = path.join(dir, 'elements.json');
    await writeFile(file, JSON.stringify(registryWith('p.a', 'A')), 'utf8');
    await new FileRegistryRepo(file).merge(registryWith('p.b', 'B'));

    const raw = await readFile(file, 'utf8');
    assert.match(raw, /\n$/, 'giữ nguyên định dạng mà Registry.save() vẫn ghi');
    assert.doesNotThrow(() => JSON.parse(raw));
  });
});

describe('FileJobRepo ngang bằng History', () => {
  it('list() cho đúng thứ tự History.list()', async () => {
    const dir = await workspace();
    const file = path.join(dir, 'history.json');
    const history = await History.load(file);
    history.start('a.feature', 'workflow', ['gen']);
    history.start('b.feature', 'run', ['run']);
    await history.save();

    const direct = (await History.load(file)).list().map((run) => run.feature);
    const viaRepo = (await new FileJobRepo(file).list()).map((run) => run.feature);

    assert.deepEqual(viaRepo, direct);
  });

  /** Tiến trình chết giữa chừng để lại dòng `running` nói dối. Repo phải đóng được chúng. */
  it('closeInterrupted() đóng lượt treo và ghi xuống đĩa', async () => {
    const dir = await workspace();
    const file = path.join(dir, 'history.json');
    const history = await History.load(file);
    history.start('a.feature', 'run', ['run']);
    await history.save();

    const repo = new FileJobRepo(file);
    assert.equal(await repo.closeInterrupted(), 1);
    // Đọc lại từ đĩa: đóng trong RAM mà không lưu là vẫn nói dối ở lần sau.
    assert.equal((await History.load(file)).list()[0]?.status !== 'running', true);
    assert.equal(await repo.closeInterrupted(), 0, 'chạy lại không được đóng thêm gì');
  });
});

describe('FileRunRepo ngang bằng runstore', () => {
  it('list() và find() cho đúng thứ listRuns() cho', async () => {
    const root = await workspace();
    await writeRunMeta(path.join(root, '2026-09-21T00-00-00Z-web'), {
      id: '2026-09-21T00-00-00Z-web',
      platform: 'web',
      kind: 'run',
      status: 'passed',
      startedAt: '2026-09-21T00:00:00.000Z',
    });

    const direct = await listRuns(root);
    const repo = new FileRunRepo(root);

    assert.deepEqual(await repo.list(), direct);
    assert.equal((await repo.find('2026-09-21T00-00-00Z-web'))?.platform, 'web');
    assert.equal(await repo.find('không-có'), undefined, 'id lạ trả undefined, không ném');
  });
});
