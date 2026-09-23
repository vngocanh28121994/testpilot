/**
 * Link có chữ ký: ai xin được, cho khoá nào.
 *
 * Link ấy bỏ qua mọi tầng phân quyền phía trên — đó chính là điểm của nó — nên
 * chỗ phát link là nơi duy nhất còn nói không được. Hai tính chất được canh:
 * server DỰNG khoá chứ không nhận khoá, và không ai xin được link cho job của
 * người khác.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { artifactRoutes } from '../artifacts.js';
import { MemoryJobQueue } from '../../queue/memoryQueue.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';
import { MemoryDeviceRegistry } from '../../devices/memoryRegistry.js';
import { MemoryDeviceGrants } from '../../devices/memoryGrants.js';
import { MemorySessionStore } from '../../auth/session.js';
import type { ArtifactRepo, NewArtifact } from '../../storage/artifactRepo.js';
import type { ArtifactStore } from '../../storage/artifacts.js';
import type { Identity, Role } from '../../auth/roles.js';
import type { Repos } from '../../db/repo.js';
import type { RouteContext } from '../types.js';

function person(userId: string, role: Role = 'runner_user', orgId = 'org-1'): Identity {
  return { userId, orgId, email: `${userId}@x.dev`, role };
}

function fakeRes(): { res: ServerResponse; out: { status?: number; headers: any; body: any } } {
  const out: { status?: number; headers: any; body: any } = { headers: {}, body: {} };
  let raw = '';
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status;
      if (headers) out.headers = headers;
      return this;
    },
    end(chunk?: unknown) {
      if (chunk) raw += String(chunk);
      try { out.body = JSON.parse(raw); } catch { out.body = {}; }
    },
  } as unknown as ServerResponse;
  return { res, out };
}

describe('route artifact', () => {
  let queue: MemoryJobQueue;
  let recorded: NewArtifact[];
  let signedFor: string[];
  let jobId: string;

  const store = {
    put: async (key: string) => ({ key }),
    signedUrl: async (key: string, ttl?: number) => `https://s3/get/${key}?ttl=${ttl}`,
    signedPutUrl: async (key: string) => {
      signedFor.push(key);
      return `https://s3/put/${key}`;
    },
    list: async () => [],
    get: async () => Buffer.alloc(0),
    remove: async () => {},
  } satisfies ArtifactStore;

  const repo: ArtifactRepo = {
    record: async (rows) => { recorded.push(...rows); return rows.length; },
    forJob: async () => [],
    olderThan: async () => [],
    forget: async () => 0,
  };

  function context(identity: Identity, withStore = true): RouteContext {
    return {
      configFile: 'testpilot.config.json',
      configProfile: { owner: 't', source: 'personal' },
      identity,
      repos: { queue } as unknown as Repos,
      runners: new MemoryRunnerRegistry(),
      devices: new MemoryDeviceRegistry(),
      grants: new MemoryDeviceGrants(),
      sessions: new MemorySessionStore(),
      ...(withStore ? { artifacts: { store, repo } } : {}),
    };
  }

  async function call(route: string, identity: Identity, body?: unknown, query = '', withStore = true) {
    const { res, out } = fakeRes();
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')],
    ) as IncomingMessage;
    const path = route.split(' ')[1]!;
    await artifactRoutes[route]!(
      req, res, new URL(`http://x${path}${query}`), context(identity, withStore),
    );
    return out;
  }

  beforeEach(async () => {
    queue = new MemoryJobQueue();
    recorded = [];
    signedFor = [];
    const job = await queue.create({
      orgId: 'org-1', kind: 'run_suite', createdBy: 'an', priority: 5,
      spec: { platform: 'web' },
    } as never);
    jobId = job.id;
    await queue.claim({ runnerId: 'runner-1' } as never);
  });

  it('server DỰNG khoá, không nhận khoá của runner', async () => {
    const out = await call('POST /api/runner/artifacts/sign', person('runner-1'), {
      jobId, files: ['run-1/report.html'],
    });

    assert.equal(out.status, 200);
    // Runner gửi đường dẫn tương đối; `orgId` và `jobId` do server gắn vào.
    // Nhận khoá do runner tự đặt nghĩa là một runner bị chiếm ghi đè được
    // report của tổ chức khác.
    assert.deepEqual(signedFor, [`org-1/${jobId}/run-1/report.html`]);
    assert.equal(out.body.uploads[0].contentType, 'text/html; charset=utf-8');
  });

  it('không xin được link cho job của runner khác', async () => {
    const out = await call('POST /api/runner/artifacts/sign', person('runner-2'), {
      jobId, files: ['run-1/report.html'],
    });
    assert.equal(out.status, 403);
    assert.deepEqual(signedFor, [], 'không được ký gì cả');
  });

  it('job không có thật thì 404', async () => {
    const out = await call('POST /api/runner/artifacts/sign', person('runner-1'), {
      jobId: 'khong-co', files: ['a.txt'],
    });
    assert.equal(out.status, 404);
  });

  it('xin quá nhiều file một lần thì bị chặn, kèm cách chia lô', async () => {
    const out = await call('POST /api/runner/artifacts/sign', person('runner-1'), {
      jobId, files: Array.from({ length: 501 }, (_, i) => `f-${i}.txt`),
    });
    assert.equal(out.status, 400);
    assert.match(out.body.error, /chia lô/);
  });

  it('ghi sổ BỎ QUA khoá của tổ chức khác', async () => {
    const out = await call('POST /api/runner/artifacts/done', person('runner-1'), {
      jobId,
      files: [
        { key: `org-1/${jobId}/run-1/report.html`, bytes: 10 },
        { key: `org-2/${jobId}/run-1/bi-mat.html`, bytes: 10 },
      ],
    });

    assert.equal(out.body.recorded, 1);
    assert.deepEqual(recorded.map((row) => row.storageKey), [`org-1/${jobId}/run-1/report.html`]);
    assert.equal(recorded[0]!.kind, 'report');
  });

  it('mở artifact thì chuyển hướng sang link có chữ ký', async () => {
    const out = await call(
      'GET /api/artifact', person('an', 'maintainer'), undefined,
      `?key=${encodeURIComponent('org-1/job/run-1/report.html')}`,
    );
    assert.equal(out.status, 302);
    assert.match(String(out.headers.location), /^https:\/\/s3\/get\//);
    // Link có hạn KHÔNG được nằm trong cache nào: nó là một khoá tạm thời.
    assert.equal(out.headers['cache-control'], 'no-store');
  });

  it('người chỉ xem nhận link ngắn hạn hơn', async () => {
    const ofRole = async (role: Role) => {
      const out = await call(
        'GET /api/artifact', person('an', role), undefined,
        `?key=${encodeURIComponent('org-1/job/a.html')}`,
      );
      return Number(/ttl=(\d+)/.exec(String(out.headers.location))?.[1]);
    };
    // Link càng sống lâu thì càng dễ rời khỏi tay người được cấp.
    assert.ok(await ofRole('viewer') < await ofRole('maintainer'));
  });

  it('khoá của tổ chức khác trả 404, không phải 403', async () => {
    const out = await call(
      'GET /api/artifact', person('an', 'admin'), undefined,
      `?key=${encodeURIComponent('org-2/job/bi-mat.html')}`,
    );
    // Phân biệt "file của tổ chức khác" với "file không có thật" là nói cho
    // người lạ biết tổ chức nào có lượt chạy nào.
    assert.equal(out.status, 404);
  });

  it('host chưa cấu hình kho thì 501, không im lặng bỏ qua', async () => {
    const out = await call(
      'GET /api/artifact', person('an', 'admin'), undefined,
      `?key=${encodeURIComponent('org-1/job/a.html')}`, false,
    );
    // 501 là cách duy nhất người deploy biết mình quên một biến môi trường.
    assert.equal(out.status, 501);
  });
});
