/**
 * Runner báo xong, và phần nó học được đi về đâu.
 *
 * Đây là lời hứa của mục 4b kiểm bằng route thật: runner KHÔNG ghi vào
 * registry. Nó gửi delta, và control plane chia đôi — thứ an toàn gộp ngay,
 * thứ đè lên người khác thì treo lại thành đề xuất có `source_job_id`, để
 * người duyệt biết nó đến từ lượt chạy nào.
 *
 * Bài cuối là bài dễ bị viết sai nhất, và nó đã suýt sai: đề xuất phải mang
 * CẢ registry chứ không chỉ phần đổi, vì lúc duyệt `review` gọi `write()` —
 * ghi đè toàn bộ. Gửi lên mỗi phần đổi thì duyệt xong registry chỉ còn mấy
 * element ấy, và mọi thứ khác biến mất.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runnerRoutes } from '../runner.js';
import { fileRepos } from '../../db/fileRepo.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';
import { MemoryDeviceRegistry } from '../../devices/memoryRegistry.js';
import { AUTO_ACCEPT_WINS } from '../../proposals/policy.js';
import type { ElementDef, ElementRegistry } from '../../../core/types.js';
import type { Identity } from '../../auth/roles.js';
import type { Repos } from '../../db/repo.js';
import type { RouteContext } from '../types.js';

const RUNNER: Identity = {
  userId: 'runner-1', orgId: 'org-1', email: 'runner@x.dev', role: 'runner_user',
};

function element(id: string, value: string, wins?: number): ElementDef {
  return {
    id, label: id, screen: 'login',
    candidates: { android: [{ strategy: 'predicate', value, weight: 1, origin: 'healed' }] },
    ...(wins === undefined
      ? {}
      : { health: { resolutions: wins, heals: 1, winners: { [value]: wins } } }),
  };
}

function fakeRes(): { res: ServerResponse; out: { status?: number; body: any } } {
  const out: { status?: number; body: any } = { body: {} };
  let raw = '';
  const res = {
    writeHead(status: number) { out.status = status; return this; },
    end(chunk?: unknown) {
      if (chunk) raw += String(chunk);
      try { out.body = JSON.parse(raw); } catch { out.body = {}; }
    },
  } as unknown as ServerResponse;
  return { res, out };
}

describe('runner báo xong kèm phần học được', () => {
  let repos: Repos;

  async function report(jobId: string, proposal: unknown) {
    const { res, out } = fakeRes();
    const req = Readable.from([Buffer.from(JSON.stringify({
      jobId, result: { state: 'succeeded', registryProposal: proposal },
    }), 'utf8')]) as IncomingMessage;
    const ctx: RouteContext = {
      configFile: 'testpilot.config.json',
      configProfile: { owner: 't', source: 'personal' },
      identity: RUNNER,
      repos,
      runners: new MemoryRunnerRegistry(),
      devices: new MemoryDeviceRegistry(),
    };
    await runnerRoutes['POST /api/runner/result']!(
      req, res, new URL('http://x/api/runner/result'), ctx,
    );
    return out;
  }

  async function newJob(): Promise<string> {
    const job = await repos.queue.create({
      createdBy: RUNNER.userId, orgId: RUNNER.orgId, priority: 5,
      payload: { kind: 'run', params: { platform: 'android' } },
    } as never);
    await repos.queue.claim({ runnerId: RUNNER.userId, platforms: ['android'] } as never);
    return job.id;
  }

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tp-absorb-'));
    repos = fileRepos({
      registry: path.join(dir, 'elements.json'),
      runs: path.join(dir, 'runs'),
    });
    await repos.registry.write({
      version: 1, screens: {},
      elements: { login_btn: element('login_btn', 'name == "cũ"') },
    } as ElementRegistry);
  });

  it('element mới gộp thẳng, không tạo đề xuất', async () => {
    const jobId = await newJob();
    const out = await report(jobId, {
      version: 1, screens: {}, elements: { otp: element('otp', 'name == "otp"') },
    });

    assert.equal(out.status, 200);
    assert.deepEqual(out.body.learned, { merged: 1, pending: 0 });
    const after = await repos.registry.read();
    assert.ok(after.data.elements.otp, 'element mới phải có mặt ngay');
    assert.deepEqual(
      (await repos.proposals.list()).filter((item) => item.sourceJobId === jobId), [],
    );
  });

  it('locator đổi mà chưa đủ tin thì thành đề xuất kèm job sinh ra nó', async () => {
    const jobId = await newJob();
    const before = await repos.registry.read();
    const out = await report(jobId, {
      version: 1, screens: {},
      elements: { login_btn: element('login_btn', 'name == "mới"', AUTO_ACCEPT_WINS - 1) },
    });

    assert.deepEqual(out.body.learned, { merged: 0, pending: 1 });
    const after = await repos.registry.read();
    assert.equal(
      after.data.elements.login_btn!.candidates.android![0]!.value, 'name == "cũ"',
      'registry KHÔNG được đổi trước khi có người duyệt',
    );

    // Sổ đề xuất của bản file là MỘT cho cả tiến trình, nên lọc theo job của
    // chính bài này thay vì tin rằng danh sách chỉ có một dòng.
    const [proposal] = (await repos.proposals.list())
      .filter((item) => item.sourceJobId === jobId);
    assert.ok(proposal);
    assert.equal(proposal.sourceJobId, jobId, 'phải biết đề xuất đến từ lượt chạy nào');
    assert.equal(proposal.baseRevision, before.revision);
    assert.deepEqual(proposal.summary, { added: [], removed: [], changed: ['login_btn'] });
  });

  it('đề xuất mang cả registry, nên duyệt xong không mất element nào', async () => {
    const jobId = await newJob();
    await report(jobId, {
      version: 1, screens: {},
      elements: {
        login_btn: element('login_btn', 'name == "mới"', 1),
        otp: element('otp', 'name == "otp"'),
      },
    });

    const [proposal] = (await repos.proposals.list())
      .filter((item) => item.sourceJobId === jobId);
    const patch = proposal!.patch as ElementRegistry;
    // `otp` đã được gộp thẳng ở bước trên; nó vẫn phải có trong bản đề xuất,
    // nếu không lúc duyệt nó sẽ bị ghi đè mất.
    assert.deepEqual(Object.keys(patch.elements).sort(), ['login_btn', 'otp']);
  });

  it('không gửi gì thì không có gì xảy ra', async () => {
    const jobId = await newJob();
    const out = await report(jobId, undefined);
    assert.equal(out.status, 200);
    assert.equal(out.body.learned, undefined);
    assert.deepEqual(
      (await repos.proposals.list()).filter((item) => item.sourceJobId === jobId), [],
    );
  });
});
