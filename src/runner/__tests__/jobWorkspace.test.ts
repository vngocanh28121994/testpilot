/**
 * Job mang snapshot chạy trên đúng snapshot ấy, trong thư mục riêng.
 *
 * Điều đáng giữ nhất ở đây là phép CHẶN TÊN: tên feature tới từ mạng, và ghi
 * `../../.ssh/authorized_keys` ra đĩa theo lệnh control plane là trao quyền
 * ghi file tuỳ ý lên laptop của người khác cho bất cứ ai chiếm được control
 * plane.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareJobWorkspace, safeFeatureName } from '../jobWorkspace.js';

let tmp: string;
let baseConfig: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tp-job-'));
  baseConfig = path.join(tmp, 'base.json');
  await writeFile(baseConfig, JSON.stringify({
    web: { baseUrl: 'https://x.dev' },
    paths: { runs: 'runs', registry: 'registry/elements.json' },
    defaultEnv: 'sit',
  }));
});
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

const snapshot = {
  registryRevision: 'r1',
  registry: { elements: { login: { id: 'login' } } },
  features: [{ name: 'dang-nhap.feature', content: 'Feature: Đăng nhập\n' }],
};

describe('dựng thư mục job từ snapshot', () => {
  it('đặt feature và registry vào thư mục riêng của job', async () => {
    const ws = await prepareJobWorkspace({ jobId: 'job-1', snapshot, configFile: baseConfig, root: tmp });
    assert.equal(
      await readFile(path.join(ws.dir, 'features', 'dang-nhap.feature'), 'utf8'),
      'Feature: Đăng nhập\n',
    );
    const registry = JSON.parse(await readFile(path.join(ws.dir, 'registry', 'elements.json'), 'utf8'));
    assert.deepEqual(registry, snapshot.registry);
    assert.deepEqual(ws.features, ['dang-nhap.feature']);
  });

  it('config dẫn xuất chỉ ghi đè ba đường dẫn, giữ nguyên mọi thứ khác', async () => {
    const ws = await prepareJobWorkspace({ jobId: 'job-2', snapshot, configFile: baseConfig, root: tmp });
    const cfg = JSON.parse(await readFile(ws.configFile, 'utf8'));
    assert.equal(cfg.paths.features, path.join(ws.dir, 'features'));
    assert.equal(cfg.paths.registry, path.join(ws.dir, 'registry', 'elements.json'));
    assert.equal(cfg.paths.scenarioReviewDb, path.join(ws.dir, 'registry', 'scenario-review.json'));
    // `runs` vẫn của runner: report của lượt chạy phải nằm ở chỗ thường lệ,
    // nơi phần đẩy artifact và trang lịch sử tìm tới.
    assert.equal(cfg.paths.runs, 'runs');
    assert.equal(cfg.defaultEnv, 'sit');
  });

  it('dọn sạch thư mục job', async () => {
    const ws = await prepareJobWorkspace({ jobId: 'job-3', snapshot, configFile: baseConfig, root: tmp });
    await ws.cleanup();
    assert.equal(existsSync(ws.dir), false);
  });

  it('tên feature leo ra ngoài thư mục thì từ chối, và không ghi byte nào', async () => {
    await assert.rejects(
      prepareJobWorkspace({
        jobId: 'job-4',
        snapshot: { ...snapshot, features: [{ name: '../../.ssh/authorized_keys', content: 'x' }] },
        configFile: baseConfig,
        root: tmp,
      }),
      /không hợp lệ/,
    );
    assert.equal(existsSync(path.join(tmp, 'job-4')), false);
  });

  it('mã job leo ra ngoài thư mục cũng bị chặn', async () => {
    await assert.rejects(
      prepareJobWorkspace({ jobId: '../x', snapshot, configFile: baseConfig, root: tmp }),
      /không hợp lệ/,
    );
  });
});

describe('tên feature an toàn', () => {
  it('nhận tên trần có đuôi .feature', () => {
    assert.equal(safeFeatureName('2026-09-24-dang-nhap.feature'), '2026-09-24-dang-nhap.feature');
  });

  it('từ chối đường dẫn, đuôi khác, và tên ẩn', () => {
    for (const bad of ['a/b.feature', '../b.feature', 'b.txt', '.feature', '.x.feature', '']) {
      assert.throws(() => safeFeatureName(bad), /không hợp lệ/, bad);
    }
  });
});
