/**
 * Workflow Studio chạy được trên máy cắm ở LAPTOP NGƯỜI KHÁC.
 *
 * Trước đây workflow sinh file feature ở máy chủ rồi gọi `runSuite` tại chỗ,
 * nên nó chỉ chạm được máy cắm vào chính máy chủ — trong khi màn Local Runner
 * đã chạy được trên mọi máy qua hàng đợi. Bài này đo cây cầu giữa hai bên,
 * bằng một `RemoteRuns` giả: không dựng hàng đợi, không cần điện thoại.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { History, WORKFLOW_STAGES } from '../../../core/history.js';
import { ScenarioReviewStore } from '../../../core/scenarioReview.js';
import { continueWorkflow, remotePreflight } from '../workflow.js';
import type { RemoteDevice, RemoteRunRequest, RemoteRuns } from '../../remoteRuns.js';

const FEATURE = `Feature: Chuyển tiền

  Scenario: Chuyển thành công
    Given tôi mở màn hình "chuyển tiền"

  Scenario: Chuyển quá hạn mức
    Given tôi mở màn hình "chuyển tiền"
    Then tôi thấy "vượt hạn mức"
`;

const LAPTOP: RemoteDevice = {
  udid: 'R5CY21WADDY', label: 'Samsung SM-S938B', runnerId: 'runner:binh',
  runnerName: 'laptop của Bình', offline: false, ready: true,
};

let tmp: string;
let configFile: string;
let historyFile: string;
let runId: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tp-wf-'));
  const features = path.join(tmp, 'features');
  await mkdir(features, { recursive: true });
  await writeFile(path.join(features, 'chuyen-tien.feature'), FEATURE);

  const reviewDb = path.join(tmp, 'registry', 'scenario-review.json');
  await mkdir(path.dirname(reviewDb), { recursive: true });
  const reviews = await ScenarioReviewStore.load(reviewDb);
  reviews.review('chuyen-tien.feature', 'Chuyển thành công', FEATURE, 'approve');
  // Kịch bản bị TỪ CHỐI: nó không được đi sang runner ở xa. Ở đó một file mới
  // được coi là đã duyệt hết, nên gửi nguyên file là chạy luôn nó.
  reviews.review('chuyen-tien.feature', 'Chuyển quá hạn mức', FEATURE, 'reject');
  await reviews.save();

  configFile = path.join(tmp, 'testpilot.config.json');
  await writeFile(configFile, JSON.stringify({
    web: { baseUrl: 'https://x.dev' },
    paths: {
      features, scenarioReviewDb: reviewDb, runs: path.join(tmp, 'runs'),
      registry: path.join(tmp, 'registry', 'elements.json'),
    },
    workflow: { platforms: ['android'], devices: { android: 'R5CY21WADDY' } },
  }));

  historyFile = path.join(tmp, 'history.json');
  const history = await History.load(historyFile);
  const run = history.start('Chuyển tiền', 'workflow', WORKFLOW_STAGES);
  run.status = 'waiting_review';
  run.generatedFile = 'chuyen-tien.feature';
  await history.save();
  runId = run.id;
});

afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

function fakeRemote(device: RemoteDevice | undefined, state: 'succeeded' | 'failed' = 'succeeded') {
  const sent: RemoteRunRequest[] = [];
  const remote: RemoteRuns = {
    locate: async (udid) => (device && device.udid === udid ? device : undefined),
    run: async (request, log) => {
      sent.push(request);
      log('dòng từ runner ở xa');
      return { jobId: 'job-xyz', state };
    },
  };
  return { remote, sent };
}

describe('workflow trên máy ở runner khác', () => {
  it('gửi qua hàng đợi, đúng máy, và CHỈ kịch bản đã duyệt', async () => {
    const { remote, sent } = fakeRemote(LAPTOP);
    const lines: string[] = [];
    await continueWorkflow(configFile, runId, (l) => lines.push(l), () => {}, undefined, remote, historyFile);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.udid, 'R5CY21WADDY');
    assert.equal(sent[0]!.platform, 'android');
    assert.equal(sent[0]!.feature.name, 'chuyen-tien.feature');
    assert.match(sent[0]!.feature.content, /Chuyển thành công/);
    assert.doesNotMatch(sent[0]!.feature.content, /Chuyển quá hạn mức/, 'kịch bản bị từ chối lọt sang runner');
    // Log của runner ở xa chảy về log của workflow.
    assert.ok(lines.some((l) => l.includes('dòng từ runner ở xa')));
    assert.ok(lines.some((l) => l.includes('laptop của Bình')), 'phải nói máy nằm ở đâu');
  });

  it('job xanh thì workflow xanh, và nói report nằm ở job nào', async () => {
    const { remote } = fakeRemote(LAPTOP, 'succeeded');
    await continueWorkflow(configFile, runId, () => {}, () => {}, undefined, remote, historyFile);
    const run = (await History.load(historyFile)).find(runId)!;
    assert.equal(run.status, 'passed');
    // Report nằm trên runner ở xa; không có file nào trên đĩa máy chủ không có
    // nghĩa là giai đoạn report hỏng.
    assert.equal(run.stages[9]!.status, 'done');
    assert.ok(run.log.some((l) => l.includes('job-xyz')));
  });

  it('job đỏ thì workflow đỏ', async () => {
    const { remote } = fakeRemote(LAPTOP, 'failed');
    await continueWorkflow(configFile, runId, () => {}, () => {}, undefined, remote, historyFile);
    const run = (await History.load(historyFile)).find(runId)!;
    assert.equal(run.status, 'failed');
  });

  it('chọn "bản đã tải lên" với máy ở xa thì dừng TRƯỚC khi đặt job', async () => {
    const { remote, sent } = fakeRemote(LAPTOP);
    await continueWorkflow(configFile, runId, () => {}, () => {}, 'upload', remote, historyFile);
    assert.equal(sent.length, 0);
    const run = (await History.load(historyFile)).find(runId)!;
    assert.equal(run.status, 'failed');
    assert.ok(run.log.some((l) => l.includes('Chưa gửi được bản đã tải lên')));
  });

  it('máy ở xa đang tắt thì dừng TRƯỚC khi đặt job', async () => {
    const { remote, sent } = fakeRemote({ ...LAPTOP, offline: true });
    await continueWorkflow(configFile, runId, () => {}, () => {}, undefined, remote, historyFile);
    assert.equal(sent.length, 0, 'không được đặt job lên một máy đã tắt');
    const run = (await History.load(historyFile)).find(runId)!;
    assert.equal(run.status, 'failed');
    assert.match(run.error ?? '', /android/);
  });
});

describe('phép kiểm cho máy ở xa', () => {
  it('máy sẵn sàng thì qua, và nói nó nằm ở đâu', () => {
    const result = remotePreflight('android', LAPTOP);
    assert.equal(result.ok, true);
    assert.match(result.checks[0]!.detail, /laptop của Bình/);
  });

  it('chưa đo KHÔNG phải hỏng', () => {
    // Runner vừa khởi động thì chưa kịp đo. Chặn nó là chặn một máy tốt.
    const { ready: _ready, ...unmeasured } = LAPTOP;
    assert.equal(remotePreflight('android', unmeasured).ok, true);
  });

  it('"bản đã tải lên" thì dừng — runner ở xa sẽ cài nhầm bản build của chính nó', () => {
    // `appKey` có khai báo nhưng chưa runner nào đọc. Cho qua là để laptop
    // cài bất cứ bản build cũ nào đang nằm trên đĩa của nó, rồi báo kết quả
    // như thể đã chạy trên bản vừa tải.
    const result = remotePreflight('android', LAPTOP, 'upload');
    assert.equal(result.ok, false);
    assert.ok(result.checks.some((c) => c.name === 'Nguồn app' && !c.ok));
    assert.equal(remotePreflight('android', LAPTOP, 'device').ok, true);
  });

  it('máy tính giữ nó thiếu driver thì dừng, kèm lý do của chính runner ấy', () => {
    const result = remotePreflight('ios', { ...LAPTOP, ready: false, reason: 'Chưa cài Xcode.' });
    assert.equal(result.ok, false);
    assert.match(result.checks[1]!.detail, /Chưa cài Xcode/);
  });
});
