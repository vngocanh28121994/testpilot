import type { StateResponse, HealingResponse } from '@core/ui/contracts.js';

/**
 * Fixture bám sát hình dạng thật của server.
 *
 * Kiểu tường minh ở đây là cố ý: nếu contract đổi, fixture đỏ ngay tại
 * `tsc -b ui` chứ không phải ở một assertion khó hiểu trong test.
 */
export const stateFixture: StateResponse = {
  // Bám sát config thật (11 khoá trong `paths`). Fixture mỏng hơn sẽ để lọt
  // đúng loại lỗi mà màn hình Settings hay gặp: đọc một nhánh config không có.
  config: {
    web: { baseUrl: 'https://example.com', headless: true, device: 'chromium-desktop' },
    android: {},
    ios: {},
    paths: {
      registry: 'registry/elements.json',
      features: 'features',
      artifacts: 'artifacts',
      reports: 'reports',
      runs: 'runs',
      flakeDb: 'registry/flake.json',
      healingDb: 'registry/healing.json',
      actionsDb: 'registry/actions.json',
      scenarioReviewDb: 'registry/scenario-review.json',
      deviceEnvDb: 'registry/device-env.json',
      docs: 'docs',
    },
    accounts: [{ label: 'khach-hang', username: 'user@example.com' }],
    environments: {},
    defaultEnv: '',
    farm: {},
    // Bốn khoá dưới đây có mặt trong MỌI phản hồi thật (ConfigSchema đặt
    // default cho tất cả), và Studio đọc thẳng `cfg.workflow.platforms` —
    // fixture thiếu chúng thì panel ném TypeError trước cả assertion đầu tiên.
    sources: [],
    targetFeature: '',
    workflow: { platforms: ['web'], headed: false },
    llm: { model: 'auto', effort: 'high', note: '' },
  } as unknown as StateResponse['config'],
  configError: null,
  configFile: '/tmp/testpilot.config.json',
  features: [
    {
      name: 'dang-nhap.feature',
      content: '',
      revision: 'r1',
      feature: 'Đăng nhập',
      background: [],
      scenarios: [
        // Hai tag khác nhau, cố ý: bộ lọc tag là multi-select, mà một fixture
        // chỉ có đúng một tag thì không phân biệt được "chọn được nhiều" với
        // "chọn được một".
        { name: 'Đăng nhập thành công', tags: ['@web', '@smoke'], platforms: ['web'], steps: 4, stepTexts: [], review: null },
        { name: 'Sai mật khẩu', tags: ['@web'], platforms: ['web'], steps: 3, stepTexts: [], review: null },
      ],
      coverage: null,
      error: null,
    },
    // File hỏng vẫn phải hiện — lỗi binding là thứ cần sửa (server.ts:1067).
    {
      name: 'chuyen-tien.feature',
      content: '',
      revision: 'r2',
      feature: 'chuyen-tien.feature',
      scenarios: [],
      coverage: null,
      error: 'Không bind được element: transfer.amount',
    },
  ],
  elements: 106,
  reports: [],
  runs: [
    { id: 'run-1', status: 'passed', stagesDone: 4 },
    { id: 'run-2', status: 'failed', stagesDone: 2 },
    { id: 'run-3', status: 'failed', stagesDone: 1 },
  ] as unknown as StateResponse['runs'],
  // KHÔNG có trường `password` — xem R9 và test ở api/__tests__/secrets.test.ts.
  accounts: [{ label: 'khach-hang', username: 'user@example.com', hasPassword: true }],
  hasApiKey: true,
  modelKeys: { deepseek: false, gemini: false, anthropic: true },
  appBuilds: { android: null, ios: null },
  deviceEnv: {},
  envBuilds: {},
  tagTaxonomy: { version: 1, definitions: [], featurePattern: '@feature-<ten-chuc-nang>' } as unknown as StateResponse['tagTaxonomy'],
};

import type { HealingRecordView } from '@core/ui/contracts.js';

function record(over: Partial<HealingRecordView> = {}): HealingRecordView {
  return {
    id: 'h1',
    elementId: 'login.submit',
    platform: 'web',
    current: { strategy: 'css', value: '#old-btn', weight: 0.5, origin: 'authored' },
    proposed: { strategy: 'testId', value: 'login-submit', weight: 0.9, origin: 'healed' },
    primary: { strategy: 'css', value: '#old-btn', weight: 0.5, origin: 'authored' },
    quality: { score: 92, stable: true, persistable: true, promotable: true, reasons: [] },
    successes: 5,
    runs: 3,
    runIds: ['r1', 'r2', 'r3'],
    devices: { 'Pixel 7': 3, 'iPhone 15': 2 },
    deviceCount: 2,
    firstSeen: '2026-08-01T10:00:00.000Z',
    lastSeen: '2026-08-20T14:30:00.000Z',
    status: 'proposed',
    ...over,
  } as HealingRecordView;
}

export const healingRecord = record;

export const healingFixture: HealingResponse = {
  policy: { minSuccesses: 3, minRuns: 2 },
  records: [
    record(),
    // Không đạt quality gate ⇒ nút "Áp dụng" phải bị khoá VÀ nói ra lý do.
    record({
      id: 'h2',
      elementId: 'cart.total',
      platform: 'android',
      quality: {
        score: 31,
        stable: false,
        persistable: false,
        promotable: false,
        reasons: ['xpath theo vị trí', 'không có testId'],
      },
      proposed: { strategy: 'xpath', value: '//div[3]/span[2]', weight: 0.2, origin: 'healed' },
    }),
    // Một máy nhưng nhiều run ⇒ bằng chứng yếu, bản cũ làm mờ ô Máy.
    record({ id: 'h3', elementId: 'home.banner', platform: 'ios', status: 'watching', devices: { 'iPhone 15': 4 }, deviceCount: 1, runs: 4 }),
    record({ id: 'h4', elementId: 'nav.logout', status: 'applied' }),
  ],
  summary: { total: 4, proposed: 2, watching: 1, applied: 1, rejected: 0 },
};

/* ------------------------------------------------------------------ */
/* Workflow Gate                                                       */
/* ------------------------------------------------------------------ */

import type {
  FeatureSummary,
  RunHistoryEntry,
  ScenarioSummary,
  WorkflowQuestion,
  WorkflowStage,
} from '@core/ui/contracts.js';

/** 11 stage của WORKFLOW_STAGES, dừng lại đúng ở bước chờ duyệt (bước 6). */
const gateStages: WorkflowStage[] = [
  { name: 'Đọc và xác thực tài liệu', status: 'done' },
  { name: 'AI phân tích yêu cầu, màn hình và element', status: 'done' },
  { name: 'Cập nhật element registry', status: 'done' },
  { name: 'Sinh bộ testcase', status: 'done' },
  { name: 'Chuẩn hoá và bind step', status: 'done' },
  { name: 'Chờ duyệt / chỉnh sửa testcase', status: 'running' },
  { name: 'Chuẩn bị môi trường automation', status: 'pending' },
  { name: 'Chạy các kịch bản đã duyệt', status: 'pending' },
  { name: 'Healing và chạy lại lỗi locator', status: 'pending' },
  { name: 'Sinh report, ảnh và video', status: 'pending' },
  { name: 'Hoàn tất workflow', status: 'pending' },
];

export const gateQuestions: WorkflowQuestion[] = [
  {
    id: 'wf-1-q1',
    kind: 'radio',
    prompt: 'Danh mục theo dõi nào là danh mục mặc định?',
    rationale: 'Tài liệu nhắc tới hai danh mục mà không nói cái nào mở sẵn.',
    options: ['Danh mục của tôi', 'Danh mục đề xuất'],
    source: 'generation',
  },
  {
    id: 'wf-1-q2',
    kind: 'text',
    prompt: 'Số tài khoản dùng để kiểm thử chuyển tiền?',
    source: 'healing',
    context: { scenario: 'Chuyển tiền nội bộ', line: 12 },
  },
];

function scenario(name: string, status: 'pending' | 'approved' | 'rejected'): ScenarioSummary {
  return {
    name,
    tags: ['@web'],
    platforms: ['web'],
    steps: 4,
    stepTexts: [],
    review: { status } as ScenarioSummary['review'],
  };
}

/**
 * State có một workflow đang dừng ở gate.
 *
 * `stateFixture` cố ý KHÔNG chứa run nào `kind: 'workflow'`, nên gate vắng mặt
 * ở mọi test khác — đúng như hành vi thật khi không có workflow nào đang chờ.
 */
export function gateState(
  over: {
    status?: RunHistoryEntry['status'];
    reviews?: Array<'pending' | 'approved' | 'rejected'>;
    questions?: WorkflowQuestion[];
    missing?: FeatureSummary['coverage'];
  } = {},
): StateResponse {
  const reviews = over.reviews ?? ['pending', 'pending'];
  const feature: FeatureSummary = {
    name: 'dang-nhap.feature',
    content: 'Feature: Đăng nhập\n',
    revision: 'r1',
    feature: 'Đăng nhập',
    background: [],
    scenarios: [
      scenario('Đăng nhập thành công', reviews[0] ?? 'pending'),
      scenario('Sai mật khẩu', reviews[1] ?? 'pending'),
    ],
    coverage:
      over.missing === undefined
        ? {
            decision: 'incomplete',
            total: 3,
            covered: 2,
            missing: [{ id: 'RQ-03', rule: 'Khoá tài khoản sau 5 lần sai', sourceQuote: '' }],
            auditedAt: '2026-08-27T10:00:00.000Z',
          }
        : over.missing,
    error: null,
  };

  const run = {
    id: 'wf-1',
    feature: 'Đăng nhập',
    kind: 'workflow',
    startedAt: '2026-08-27T09:00:00.000Z',
    status: over.status ?? 'waiting_review',
    stages: gateStages,
    stagesDone: 5,
    log: [],
    generatedFile: 'dang-nhap.feature',
    generated: { scenarios: 2, steps: 7, screens: 1, elements: 12, visuals: 3 },
    questions: over.questions ?? [],
  } as unknown as RunHistoryEntry;

  return { ...stateFixture, features: [feature], runs: [run] };
}
