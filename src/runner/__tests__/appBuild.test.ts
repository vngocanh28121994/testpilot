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
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
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
    const file = await fetchBuild('job-1', 'android', build, () => {});
    assert.equal(await readFile(file, 'utf8'), 'bản build thật');
    assert.equal(path.basename(file), `${build.sha256}.apk`);
    // Runner xin theo MÃ JOB, không theo đường dẫn: nó không có cách nào tự
    // chọn một file trên máy chủ.
    assert.equal(calls[0]!.url, 'https://cp/api/runner/build?job=job-1&platform=android');
    assert.equal(calls[0]!.auth, 'Bearer tk');
  });

  it('đã có đúng bản trong đệm thì không tải lại', async () => {
    const { fetchImpl, calls } = server('bản build thật');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    const build = ref('bản build thật');
    await fetchBuild('job-1', 'android', build, () => {});
    await fetchBuild('job-2', 'android', build, () => {});
    assert.equal(calls.length, 1, 'bản 215 MB không được đi qua mạng hai lần');
  });

  it('nhận về thứ không khớp hash thì từ chối, và không để lại gì trong đệm', async () => {
    // Một proxy công ty chèn trang lỗi, hay một lần tải đứt: cỡ gần đúng, nội
    // dung sai — và Appium sẽ cài nó rồi hỏng ở bước thứ ba.
    const { fetchImpl } = server('thứ khác hẳn!');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    await assert.rejects(fetchBuild('job-1', 'android', ref('bản build thật'), () => {}), /không khớp/);
    assert.deepEqual(await readdir(tmp), []);
  });

  it('máy chủ từ chối thì nói lại đúng câu của máy chủ', async () => {
    const { fetchImpl } = server(JSON.stringify({ error: 'Bản build app.apk đã được thay kể từ lúc đặt job.' }), 409);
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    await assert.rejects(fetchBuild('job-1', 'android', ref('x'), () => {}), /đã được thay kể từ lúc đặt job/);
  });

  it('tên hay hash lạ thì từ chối trước khi chạm đĩa', async () => {
    const { fetchImpl, calls } = server('x');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 'tk', name: 'lap', cacheDir: tmp, fetchImpl });
    await assert.rejects(fetchBuild('j', 'android', { ...ref('x'), name: '../../evil.sh' }, () => {}), /không phải \.apk hay \.ipa/);
    await assert.rejects(fetchBuild('j', 'android', { ...ref('x'), sha256: '../x' }, () => {}), /không hợp lệ/);
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
    const fresh = await fetchBuild('job-1', 'android', ref('bản mới'), () => {});
    const left = await readdir(tmp);
    assert.equal(left.length, 3);
    assert.ok(existsSync(fresh));
    assert.equal(left.includes(`${old[0]}.apk`), false, 'bản cũ nhất phải bị bỏ');
  });
});

/**
 * Bản `.app` của simulator: một gói `tar.gz`, mở một lần vào đệm.
 *
 * Gói ở đây dựng bằng `tar` THẬT: thứ cần đo là symlink và bit thực thi đi qua
 * được nguyên vẹn — mất bit thực thi, simulator cài xong rồi từ chối mở app
 * với một câu không nhắc gì tới quyền file.
 */
describe('tải bản .app về runner', () => {
  const run = promisify(execFile);

  async function packedBundle(extra: string[] = [], rewrite?: string) {
    const src = path.join(tmp, 'src');
    const app = path.join(src, 'Test.app');
    await mkdir(path.join(app, 'Frameworks'), { recursive: true });
    await writeFile(path.join(app, 'Test'), '#!/bin/sh\n', { mode: 0o755 });
    await writeFile(path.join(app, 'Frameworks', 'lib.dylib'), 'thư viện');
    await symlink('lib.dylib', path.join(app, 'Frameworks', 'Current'));
    for (const name of extra) await writeFile(path.join(src, name), 'lạc');
    const archive = path.join(tmp, 'app.tar.gz');
    await run('tar', [
      '-czf', archive, '-C', src,
      ...(rewrite ? ['-P', '-s', rewrite] : []),
      'Test.app', ...extra,
    ], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const bytes = await readFile(archive);
    const build: AppBuildRef = {
      key: 'x', name: 'Test.app', packed: 'tar.gz',
      sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
    };
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(bytes);
    }) as unknown as typeof fetch;
    return { build, fetchImpl, calls };
  }

  it('mở vào đệm, giữ nguyên bit thực thi và symlink', async () => {
    const { build, fetchImpl } = await packedBundle();
    const cacheDir = path.join(tmp, 'cache');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 't', name: 'lap', cacheDir, fetchImpl });
    const app = await fetchBuild('job-1', 'ios', build, () => {});
    assert.equal(path.basename(app), 'Test.app');
    assert.equal((await stat(path.join(app, 'Test'))).mode & 0o111, 0o111, 'mất bit thực thi');
    assert.equal(await readlink(path.join(app, 'Frameworks', 'Current')), 'lib.dylib');
    // Gói tạm và thư mục dựng dở không được nằm lại.
    assert.deepEqual(await readdir(cacheDir), [build.sha256]);
  });

  it('mở một lần: lần sau dùng đệm, không tải, không giải lại', async () => {
    const { build, fetchImpl, calls } = await packedBundle();
    const cacheDir = path.join(tmp, 'cache');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 't', name: 'lap', cacheDir, fetchImpl });
    const first = await fetchBuild('job-1', 'ios', build, () => {});
    const second = await fetchBuild('job-2', 'ios', build, () => {});
    assert.equal(first, second);
    assert.equal(calls.length, 1);
  });

  it('mục ../ trong gói thì KHÔNG mở, và không ghi gì ra ngoài', async () => {
    // Hash khớp chỉ nói gói đúng là thứ máy chủ gửi — không nói máy chủ không
    // bị chiếm. `../../evil.txt` là ghi file tuỳ ý lên laptop người khác.
    const { build, fetchImpl } = await packedBundle(['x.txt'], ',^x.txt,../../evil.txt,');
    const cacheDir = path.join(tmp, 'deep', 'cache');
    const fetchBuild = buildFetcher({ serverUrl: 'https://cp', token: 't', name: 'lap', cacheDir, fetchImpl });
    await assert.rejects(fetchBuild('job-1', 'ios', build, () => {}), /nằm ngoài Test\.app/);
    assert.equal(existsSync(path.join(tmp, 'evil.txt')), false);
    assert.deepEqual(await readdir(cacheDir), [], 'không để lại gói hay thư mục dựng dở');
  });

  it('mục nằm ngoài thư mục .app thì cũng không mở', async () => {
    const { build, fetchImpl } = await packedBundle(['lac.txt']);
    const fetchBuild = buildFetcher({
      serverUrl: 'https://cp', token: 't', name: 'lap', cacheDir: path.join(tmp, 'cache'), fetchImpl,
    });
    await assert.rejects(fetchBuild('job-1', 'ios', build, () => {}), /nằm ngoài Test\.app/);
  });

  it('tên gói không phải .app thì từ chối trước khi chạm mạng', async () => {
    const { build, fetchImpl, calls } = await packedBundle();
    const fetchBuild = buildFetcher({
      serverUrl: 'https://cp', token: 't', name: 'lap', cacheDir: path.join(tmp, 'cache'), fetchImpl,
    });
    await assert.rejects(fetchBuild('job-1', 'ios', { ...build, name: '../evil.app' }, () => {}), /không phải một thư mục \.app/);
    assert.equal(calls.length, 0);
  });
});
