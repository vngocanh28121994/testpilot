/**
 * Vòng tròn của registry: kéo về, sửa offline, đẩy lên, duyệt.
 *
 * Bài này canh đúng một tính chất, và nó là lý do P4.4b tồn tại: một người sửa
 * offline KHÔNG BAO GIỜ xoá được việc của người khác bằng một cú push. Lần đẩy
 * thứ hai trên bản nền cũ phải bị từ chối kèm phần khác biệt — không phải vì
 * người ấy sai, mà vì họ chưa nhìn thấy thứ mình sắp đè lên.
 *
 * Chạy trên `fileRepos` với thư mục tạm: registry thật nằm trên đĩa ở chế độ
 * embedded, nên phép đối chiếu revision được kiểm ở đúng hiện thực người dùng
 * đang chạy, chứ không ở một bản giả dễ tính hơn.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { registryRoutes } from '../registry.js';
import { fileRepos } from '../../db/fileRepo.js';
import { MemoryRunnerRegistry } from '../../runners/memoryRegistry.js';
import { MemoryDeviceGrants } from '../../devices/memoryGrants.js';
import { MemorySessionStore } from '../../auth/session.js';
import { MemoryDeviceRegistry } from '../../devices/memoryRegistry.js';
import type { ElementDef, ElementRegistry } from '../../../core/types.js';
import type { Identity } from '../../auth/roles.js';
import type { Repos } from '../../db/repo.js';
import type { RouteContext } from '../types.js';

function person(userId: string, role: Identity['role']): Identity {
  return { userId, orgId: 'org-1', email: `${userId}@x.dev`, role };
}

function element(id: string): ElementDef {
  return {
    id,
    label: id,
    screen: 'login',
    candidates: { android: [{ strategy: 'predicate' as const, value: `name == "${id}"`, weight: 1, origin: 'authored' as const }] },
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

describe('vòng tròn pull → sửa → push → duyệt', () => {
  let repos: Repos;
  let dir: string;

  async function call(route: string, identity: Identity, body?: unknown) {
    const { res, out } = fakeRes();
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')],
    ) as IncomingMessage;
    const ctx: RouteContext = {
      configFile: 'testpilot.config.json',
      configProfile: { owner: 't', source: 'personal' },
      identity,
      repos,
      runners: new MemoryRunnerRegistry(),
      devices: new MemoryDeviceRegistry(),
      grants: new MemoryDeviceGrants(),
      sessions: new MemorySessionStore(),
    };
    await registryRoutes[route]!(req, res, new URL(`http://x${route.split(' ')[1]}`), ctx);
    return out;
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tp-registry-'));
    repos = fileRepos({
      registry: path.join(dir, 'elements.json'),
      runs: path.join(dir, 'runs'),
    });
    // `fileRepos` dùng MỘT sổ đề xuất cho cả tiến trình, nên các bài phải bắt
    // đầu từ một registry riêng — nếu không bài sau đọc được đề xuất bài trước.
    await repos.registry.write(
      { version: 1, screens: {}, elements: { login_btn: element('login_btn') } } as ElementRegistry,
    );
  });

  it('kéo về, sửa, đẩy lên — thành đề xuất đúng nội dung', async () => {
    const pulled = await call('GET /api/registry', person('an', 'viewer'));
    assert.equal(pulled.status, 200);
    assert.ok(pulled.body.revision, 'pull phải kèm revision để lần đẩy sau đối chiếu được');

    // Sửa "offline": thêm một element, đổi một element.
    const edited = structuredClone(pulled.body.registry) as ElementRegistry;
    edited.elements.password_field = element('password_field');
    edited.elements.login_btn!.label = 'login_button';

    const pushed = await call('POST /api/registry/push', person('an', 'runner_user'), {
      registry: edited,
      baseRevision: pulled.body.revision,
    });
    assert.equal(pushed.status, 201);
    assert.deepEqual(pushed.body.summary.added, ['password_field']);
    assert.deepEqual(pushed.body.summary.changed, ['login_btn']);
    assert.deepEqual(pushed.body.summary.removed, []);
    assert.equal(pushed.body.proposal.state, 'pending');
    assert.equal(pushed.body.proposal.createdBy, 'an');

    // Registry THẬT chưa đổi: push là đề xuất, không phải ghi.
    const after = await call('GET /api/registry', person('an', 'viewer'));
    assert.equal(after.body.revision, pulled.body.revision);
    assert.ok(!after.body.registry.elements.password_field);

    // Người duyệt bấm đồng ý — bây giờ mới ghi.
    const review = await call('POST /api/proposals/review', person('bình', 'maintainer'), {
      id: pushed.body.proposal.id, decision: 'accept',
    });
    assert.equal(review.status, 200);
    assert.equal(review.body.proposal.state, 'accepted');
    assert.equal(review.body.proposal.reviewedBy, 'bình');

    const applied = await call('GET /api/registry', person('an', 'viewer'));
    assert.ok(applied.body.registry.elements.password_field);
    assert.equal(applied.body.registry.elements.login_btn.label, 'login_button');
    assert.notEqual(applied.body.revision, pulled.body.revision);
  });

  it('đẩy lần hai trên bản nền cũ thì bị từ chối kèm diff', async () => {
    const pulled = await call('GET /api/registry', person('an', 'viewer'));
    const stale = pulled.body.revision as string;

    // Người khác ghi trước — ở đây là một runner `merge` thứ nó học được.
    await repos.registry.merge(
      { version: 1, screens: {}, elements: { otp_field: element('otp_field') } } as ElementRegistry,
    );

    const edited = structuredClone(pulled.body.registry) as ElementRegistry;
    edited.elements.password_field = element('password_field');

    const pushed = await call('POST /api/registry/push', person('an', 'runner_user'), {
      registry: edited, baseRevision: stale,
    });
    assert.equal(pushed.status, 409);
    assert.match(pushed.body.error, /đã đổi ở nơi khác/);
    // Diff là giữa bản người ta đẩy và bản trên server: `otp_field` là thứ sẽ
    // MẤT nếu ta ghi đè, nên nó phải có tên trong câu trả lời.
    assert.deepEqual(pushed.body.diff.added, ['otp_field']);
    assert.deepEqual(pushed.body.diff.removed, ['password_field']);

    // Và không có đề xuất nào được tạo ra từ lần đẩy hỏng ấy.
    const pending = await call('GET /api/proposals', person('bình', 'maintainer'));
    assert.equal(
      pending.body.proposals.filter((p: { baseRevision?: string }) => p.baseRevision === stale).length,
      0,
    );
  });

  it('đẩy y nguyên bản vừa kéo thì không tạo đề xuất rỗng', async () => {
    const pulled = await call('GET /api/registry', person('an', 'viewer'));
    const pushed = await call('POST /api/registry/push', person('an', 'runner_user'), {
      registry: pulled.body.registry, baseRevision: pulled.body.revision,
    });
    assert.equal(pushed.status, 200);
    assert.equal(pushed.body.proposal, null);
  });

  it('duyệt hai lần thì lần thứ hai bị từ chối, không ghi đè lần đầu', async () => {
    const pulled = await call('GET /api/registry', person('an', 'viewer'));
    const edited = structuredClone(pulled.body.registry) as ElementRegistry;
    edited.elements.password_field = element('password_field');
    const pushed = await call('POST /api/registry/push', person('an', 'runner_user'), {
      registry: edited, baseRevision: pulled.body.revision,
    });

    const first = await call('POST /api/proposals/review', person('bình', 'maintainer'), {
      id: pushed.body.proposal.id, decision: 'accept',
    });
    assert.equal(first.status, 200);

    const second = await call('POST /api/proposals/review', person('chi', 'maintainer'), {
      id: pushed.body.proposal.id, decision: 'reject',
    });
    assert.equal(second.status, 409);
    const still = await call('GET /api/registry', person('an', 'viewer'));
    assert.ok(still.body.registry.elements.password_field, 'lần duyệt sau không được huỷ lần trước');
  });
});
