/**
 * Bản build nào một job phải cài — do máy chủ quyết định.
 *
 * Cùng phép mà `run.ts` dùng, để một môi trường chưa có bản build riêng không
 * lặng lẽ rơi về bản của môi trường mặc định: mọi môi trường dùng chung bundle
 * id, và đó là đăng nhập account SIT vào app prod.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema } from '../../config.js';
import { describeBuild } from '../appBuilds.js';

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), 'tp-ab-')); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

const cfg = (over: Record<string, unknown>) => ConfigSchema.parse({ web: { baseUrl: 'https://x.dev' }, ...over });

describe('bản build cho một job', () => {
  it('lấy bản của môi trường, kèm cỡ và hash', async () => {
    const apk = path.join(tmp, 'app-sit.apk');
    await writeFile(apk, 'bản SIT');
    const found = await describeBuild(cfg({
      defaultEnv: 'prod',
      environments: { prod: { accounts: {} }, sit: { accounts: {}, android: { app: apk } } },
    }), 'sit', 'android');
    assert.ok(found.ok);
    assert.equal(found.build.name, 'app-sit.apk');
    assert.equal(found.build.size, Buffer.byteLength('bản SIT'));
    assert.equal(found.build.sha256, createHash('sha256').update('bản SIT').digest('hex'));
  });

  it('môi trường không có bản riêng thì KHÔNG rơi về bản mặc định', async () => {
    const apk = path.join(tmp, 'app.apk');
    await writeFile(apk, 'bản prod');
    const found = await describeBuild(cfg({
      defaultEnv: 'prod', android: { app: apk },
      environments: { prod: { accounts: {} }, sit: { accounts: {} } },
    }), 'sit', 'android');
    assert.equal(found.ok, false);
    if (!found.ok) assert.match(found.reason, /chưa có android\.app riêng/);
  });

  it('config trỏ tới file không có thì nói ra', async () => {
    const found = await describeBuild(cfg({ android: { app: path.join(tmp, 'mat.apk') } }), undefined, 'android');
    assert.equal(found.ok, false);
    if (!found.ok) assert.match(found.reason, /không có trên máy chủ/);
  });

  it('thư mục .app khai cho ANDROID thì từ chối — .app chỉ là của simulator iOS', async () => {
    const app = path.join(tmp, 'App.app');
    await mkdir(app);
    const found = await describeBuild(cfg({ android: { app } }), undefined, 'android', path.join(tmp, 'a'));
    assert.equal(found.ok, false);
    if (!found.ok) assert.match(found.reason, /không phải bản \.app của simulator iOS/);
  });

  it('chưa có bản build nào thì chỉ đường', async () => {
    const found = await describeBuild(cfg({}), undefined, 'android');
    assert.equal(found.ok, false);
    if (!found.ok) assert.match(found.reason, /Bản build/);
  });

  it('file đổi thì hash đổi theo — không trả hash cũ cho bản mới', async () => {
    const apk = path.join(tmp, 'app.apk');
    await writeFile(apk, 'bản một');
    const first = await describeBuild(cfg({ android: { app: apk } }), undefined, 'android');
    await writeFile(apk, 'bản hai, dài hơn');
    const second = await describeBuild(cfg({ android: { app: apk } }), undefined, 'android');
    assert.ok(first.ok && second.ok);
    assert.notEqual(first.build.sha256, second.build.sha256);
  });
});

/**
 * Bản `.app` của simulator là một THƯ MỤC: máy chủ đóng gói nó, một lần cho
 * mỗi phiên bản.
 */
describe('bản .app của simulator', () => {
  async function makeBundle(name = 'Test.app') {
    const app = path.join(tmp, name);
    await mkdir(path.join(app, 'Frameworks'), { recursive: true });
    await writeFile(path.join(app, 'Test'), '#!/bin/sh\necho chạy\n', { mode: 0o755 });
    await writeFile(path.join(app, 'Info.plist'), '<plist/>');
    await writeFile(path.join(app, 'Frameworks', 'lib.dylib'), 'thư viện');
    return app;
  }

  it('đóng gói thành tar.gz, và gói mang đúng tên thư mục', async () => {
    const app = await makeBundle();
    const archives = path.join(tmp, 'archives');
    const found = await describeBuild(cfg({ ios: { app } }), undefined, 'ios', archives);
    assert.ok(found.ok, found.ok ? '' : found.reason);
    assert.equal(found.build.packed, 'tar.gz');
    assert.equal(found.build.name, 'Test.app');
    assert.match(found.build.key, /\.tar\.gz$/);
  });

  it('không đổi gì thì không đóng gói lại — cùng gói, cùng hash', async () => {
    const app = await makeBundle();
    const archives = path.join(tmp, 'archives');
    const a = await describeBuild(cfg({ ios: { app } }), undefined, 'ios', archives);
    const b = await describeBuild(cfg({ ios: { app } }), undefined, 'ios', archives);
    assert.ok(a.ok && b.ok);
    assert.equal(a.build.sha256, b.build.sha256);
    assert.equal(a.build.key, b.build.key);
  });

  it('một file BÊN TRONG đổi thì gói mới — gói cũ không được gửi thay bản mới', async () => {
    // Build lại bằng Xcode ghi đè file bên trong; thời điểm sửa của thư mục
    // gốc thì không nhất thiết đổi.
    const app = await makeBundle();
    const archives = path.join(tmp, 'archives');
    const a = await describeBuild(cfg({ ios: { app } }), undefined, 'ios', archives);
    await writeFile(path.join(app, 'Frameworks', 'lib.dylib'), 'thư viện bản mới hơn');
    const b = await describeBuild(cfg({ ios: { app } }), undefined, 'ios', archives);
    assert.ok(a.ok && b.ok);
    assert.notEqual(a.build.sha256, b.build.sha256);
  });

  it('thư mục không phải .app thì không đóng gói', async () => {
    const dir = path.join(tmp, 'build-folder');
    await mkdir(dir);
    const found = await describeBuild(cfg({ ios: { app: dir } }), undefined, 'ios', path.join(tmp, 'a'));
    assert.equal(found.ok, false);
  });
});
