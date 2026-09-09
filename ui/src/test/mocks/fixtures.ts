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
    llm: { model: 'auto', note: '' },
    // Studio đọc ba nhánh này ngay khi mở trang. Thiếu chúng thì panel ném
    // "Cannot read properties of undefined (reading 'platforms')" và mọi test
    // render Studio đều thấy màn hình lỗi thay vì thấy trang — đúng thứ đã xảy
    // ra, và cái ép kiểu bên dưới là lý do tsc không hề kêu.
    sources: [],
    targetFeature: '',
    workflow: { platforms: ['web'], devices: {}, env: '', headed: false },
  } as unknown as StateResponse['config'],
  configError: null,
  configFile: '/tmp/testpilot.config.json',
  features: [
    {
      name: 'dang-nhap.feature',
      // Nội dung thật, không phải chuỗi rỗng: ô sửa kịch bản cắt khối của đúng
      // một kịch bản ra khỏi đây, nên một fixture rỗng làm test đó thành vô nghĩa.
      content: [
        'Feature: Đăng nhập',
        '',
        '  @web',
        '  Scenario: Đăng nhập thành công',
        '    Given I open the app',
        '    Then I see "Trang chủ"',
        '',
        '  @web',
        '  Scenario: Sai mật khẩu',
        '    Given I open the app',
        '    Then I see "Sai mật khẩu"',
        '',
      ].join('\n'),
      revision: 'r1',
      feature: 'Đăng nhập',
      background: [],
      scenarios: [
        { id: 'dang-nhap-thanh-cong', name: 'Đăng nhập thành công', tags: ['@web'], platforms: ['web'], steps: 4, review: null, knownIssue: null, knownIssueStale: false },
        // Một file thật gần như luôn có trạng thái lẫn lộn; fixture toàn
        // `review: null` thì mọi hàng đều là pending và không test nào chạm
        // được vào nhánh đã-duyệt.
        {
          id: 'sai-mat-khau', name: 'Sai mật khẩu', tags: ['@web'], platforms: ['web'], steps: 3,
          review: {
            id: 'dang-nhap.feature::Sai mật khẩu',
            filename: 'dang-nhap.feature',
            scenarioName: 'Sai mật khẩu',
            contentHash: 'h-sai-mat-khau',
            status: 'approved',
            source: 'generated',
            updatedAt: '2026-09-01T03:00:00.000Z',
            reviewedAt: '2026-09-01T03:00:00.000Z',
          },
          knownIssue: null, knownIssueStale: false,
        },
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
    // `stages` có mặt vì dữ liệu thật luôn có: một run không stages từng làm
    // danh sách bước vỡ, và fixture là chỗ duy nhất tạo ra được tình huống đó.
    { id: 'run-1', status: 'passed', stagesDone: 4, stages: [{ name: 'Đọc tài liệu', status: 'done' }] },
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
  // Định nghĩa thật, không phải mảng rỗng: chip tag tra chính bảng này để nói ra
  // nghĩa của @p0, nên một taxonomy rỗng làm test đó thành vô nghĩa.
  tagTaxonomy: {
    version: 1,
    definitions: [
      { name: '@p0', category: 'priority', label: 'P0 · Luồng trọng yếu', description: 'Happy path hoặc mục tiêu nghiệp vụ quan trọng nhất.' },
      { name: '@p1', category: 'priority', label: 'P1 · Quy tắc quan trọng', description: 'Validation, nhánh, biên, lỗi hoặc quy tắc nghiệp vụ có ý nghĩa.' },
      { name: '@smoke', category: 'suite', label: 'Smoke', description: 'Tập kiểm tra nhanh cho mục tiêu chính.' },
      { name: '@web', category: 'platform', label: 'Web', description: 'Chạy trên trình duyệt.' },
    ],
    featurePattern: '@feature-<ten-chuc-nang>',
    aliases: {},
  } as unknown as StateResponse['tagTaxonomy'],
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
