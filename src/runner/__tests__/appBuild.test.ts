/**
 * Runner tải bản build máy chủ chọn — một lần, kiểm hash, giữ đệm có trần.
 *
 * `fetch` được tiêm, nên không có máy chủ nào ở đây và 215 MB thu lại còn vài
 * chục byte.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFetcher } from '../appBuild.js';
import type { AppBuildRef } from '../../protocol/messages.js';

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), 'tp-fb-')); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

const ref = (content: string, name = 'app.apk'): AppBuildRef => ({
  key: `build/${name}`, name,
  sha256: createHash('sha256').update(content).digest('hex'),
  size: Buffer.byteLength(content),
});

function server(body: string, status = 200) {
  const calls: Array<{ url: string; auth?: string }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: (init?.headers as Record<string, string>)?.authorization });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('tải bản build về runner', () => {
  it('tải, kiểm hash, rồi trả đường dẫn trong đệm', async () => {
    const { fetchImpl, calls } = server('bản build thật');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    const build = ref('bản build thật');
    const file = await fetchBuild('job-1', build, () => {});
    assert.equal(await readFile(file, 'utf8'), 'bản build thật');
    assert.equal(path.basename(file), `${build.sha256}.apk`);
    // Runner xin theo MÃ JOB, không theo đường dẫn: nó không có cách nào tự
    // chọn một file trên máy chủ.
    assert.equal(calls[0]!.url, 'https://cp/api/runner/build?job=job-1');
    assert.equal(calls[0]!.auth, 'Bearer tk');
  });

  it('đã có đúng bản trong đệm thì không tải lại', async () => {
    const { fetchImpl, calls } = server('bản build thật');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    const build = ref('bản build thật');
    await fetchBuild('job-1', build, () => {});
    await fetchBuild('job-2', build, () => {});
    assert.equal(calls.length, 1, 'bản 215 MB không được đi qua mạng hai lần');
  });

  it('nhận về thứ không khớp hash thì từ chối, và không để lại gì trong đệm', async () => {
    // Một proxy công ty chèn trang lỗi, hay một lần tải đứt: cỡ gần đúng, nội
    // dung sai — và Appium sẽ cài nó rồi hỏng ở bước thứ ba.
    const { fetchImpl } = server('thứ khác hẳn!');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    await assert.rejects(fetchBuild('job-1', ref('bản build thật'), () => {}), /không khớp/);
    assert.deepEqual(await readdir(tmp), []);
  });

  it('máy chủ từ chối thì nói lại đúng câu của máy chủ', async () => {
    const { fetchImpl } = server(JSON.stringify({ error: 'Bản build app.apk đã được thay kể từ lúc đặt job.' }), 409);
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    await assert.rejects(fetchBuild('job-1', ref('x'), () => {}), /đã được thay kể từ lúc đặt job/);
  });

  it('tên hay hash lạ thì từ chối trước khi chạm đĩa', async () => {
    const { fetchImpl, calls } = server('x');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    await assert.rejects(fetchBuild('j', { ...ref('x'), name: '../../evil.sh' }, () => {}), /không phải \.apk hay \.ipa/);
    await assert.rejects(fetchBuild('j', { ...ref('x'), sha256: '../x' }, () => {}), /không hợp lệ/);
    assert.equal(calls.length, 0);
  });

  it('đệm có trần: chỉ giữ ba bản dùng gần nhất', async () => {
    // Laptop của một người không phải kho lưu mọi bản build từng được tải lên.
    const old = ['a', 'b', 'c'].map((c) => c.repeat(64));
    for (const [i, sha] of old.entries()) {
      const f = path.join(tmp, `${sha}.apk`);
      await writeFile(f, 'cũ');
      const t = new Date(Date.now() - (10 - i) * 60_000);
      await utimes(f, t, t);
    }
    const { fetchImpl } = server('bản mới');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    const fresh = await fetchBuild('job-1', ref('bản mới'), () => {});
    const left = await readdir(tmp);
    assert.equal(left.length, 3);
    assert.ok(existsSync(fresh));
    assert.equal(left.includes(`${old[0]}.apk`), false, 'bản cũ nhất phải bị bỏ');
  });
});
