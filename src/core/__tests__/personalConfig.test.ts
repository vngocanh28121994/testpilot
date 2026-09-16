import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ensurePersonalConfig, personalConfigProfile } from '../personalConfig.js';

describe('personal config profile', () => {
  it('tách file theo user và không ghi vào config chung', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'testpilot-personal-config-'));
    const seed = '{"web":{"baseUrl":"https://example.com"}}\n';
    await writeFile(path.join(root, 'testpilot.config.json'), seed);

    const an = personalConfigProfile(root, 'an@example.com', '');
    const binh = personalConfigProfile(root, 'binh', '');
    assert.notEqual(an.file, binh.file);
    assert.equal(an.file, path.join(root, '.testpilot', 'users', 'an-example.com', 'config.json'));

    await ensurePersonalConfig(an, root);
    assert.equal(await readFile(an.file, 'utf8'), seed);
  });

  it('tôn trọng TESTPILOT_CONFIG cho CI và script', () => {
    const profile = personalConfigProfile('/workspace', 'qa-user', 'profiles/ci.json');
    assert.equal(profile.file, path.resolve('/workspace', 'profiles/ci.json'));
    assert.equal(profile.source, 'environment');
  });

  it('tạo sẵn thư mục profile dù workspace chưa có config mẫu', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'testpilot-empty-profile-'));
    const profile = personalConfigProfile(root, 'new-user', '');
    await ensurePersonalConfig(profile, root);
    await writeFile(profile.file, '{}\n');
    assert.equal(await readFile(profile.file, 'utf8'), '{}\n');
  });
});
