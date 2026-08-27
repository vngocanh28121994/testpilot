import { expect, test, type Page } from '@playwright/test';

const state = {
  config: {
    web: { baseUrl: 'https://example.com', headless: true, device: 'chromium' },
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
    environments: { sit: { accounts: {} } },
    defaultEnv: 'sit',
    workflow: { platforms: ['web'], env: 'sit', headed: false },
    farm: {
      region: 'us-west-2',
      platform: 'android',
      testPackagePath: 'build/testpilot.zip',
      testSpecPath: 'farm/testspec.yml',
      jobTimeoutMinutes: 30,
    },
    llm: { model: 'auto', note: '' },
    sources: ['https://example.com/spec'],
    targetFeature: 'Đăng nhập',
  },
  configError: null,
  configFile: '/tmp/testpilot.config.json',
  elements: 4,
  features: [
    {
      name: 'dang-nhap.feature',
      content: 'Feature: Đăng nhập\nScenario: Đăng nhập thành công\n Given tôi mở app\n',
      revision: 'r1',
      feature: 'Đăng nhập',
      background: [],
      scenarios: [
        {
          name: 'Đăng nhập thành công',
          tags: ['@web', '@login'],
          platforms: ['web'],
          steps: 1,
          stepTexts: ['Given tôi mở app'],
          review: null,
        },
      ],
      coverage: null,
      error: null,
    },
  ],
  reports: [],
  runs: [],
  accounts: [{ label: 'khach-hang', username: 'user@example.com', hasPassword: true }],
  hasApiKey: true,
  modelKeys: { deepseek: false, gemini: false, anthropic: true },
  appBuilds: { android: null, ios: null },
  deviceEnv: {},
  envBuilds: {},
  tagTaxonomy: { version: 1, definitions: [], featurePattern: '@feature-<ten-chuc-nang>' },
};

async function mockState(page: Page) {
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/history', (route) => route.fulfill({ json: { runs: [] } }));
}

function sse(lines: string[]) {
  return (
    lines.map((line) => `event: log\ndata: ${JSON.stringify(line)}\n\n`).join('') +
    'event: done\ndata: {"ok":true}\n\n'
  );
}

test.describe('Phase 5 — luồng dashboard', () => {
  test('Studio lưu cấu hình và khởi động workflow stream', async ({ page }) => {
    await mockState(page);
    let saved: Record<string, unknown> | undefined;
    await page.route('**/api/studio/save', async (route) => {
      saved = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ok: true, accounts: state.accounts } });
    });
    await page.route('**/api/gen', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: sse(['Đọc tài liệu nguồn', 'Sinh Gherkin']),
      }),
    );
    await page.goto('/studio');
    await page.getByRole('button', { name: 'Lưu (không chạy)' }).click();
    await expect.poll(() => saved?.targetFeature).toBe('Đăng nhập');
    await page.getByRole('button', { name: 'Bắt đầu chạy workflow' }).click();
    await expect(page.getByText('Sinh Gherkin')).toBeVisible();
  });

  test('Scenario Review duyệt một kịch bản', async ({ page }) => {
    await mockState(page);
    let reviewed: Record<string, unknown> | undefined;
    await page.route('**/api/feature/review', async (route) => {
      reviewed = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto('/scenarios');
    await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect.poll(() => reviewed?.scenarioName).toBe('Đăng nhập thành công');
  });

  test('Healing Center vẫn duyệt locator qua mutation', async ({ page }) => {
    await mockState(page);
    const healing = {
      policy: { minSuccesses: 3, minRuns: 2 },
      records: [
        {
          id: 'h1',
          elementId: 'login.submit',
          platform: 'web',
          current: { strategy: 'css', value: '#old' },
          proposed: { strategy: 'testId', value: 'submit' },
          primary: null,
          quality: { score: 90, stable: true, promotable: true, reasons: [] },
          successes: 3,
          runs: 2,
          runIds: [],
          devices: {},
          deviceCount: 1,
          lastSeen: '2026-08-27T01:00:00.000Z',
          status: 'proposed',
        },
      ],
      summary: { total: 1, proposed: 1, watching: 0, applied: 0, rejected: 0 },
    };
    await page.route('**/api/healing', (route) => route.fulfill({ json: healing }));
    await page.route('**/api/healing/review', (route) => route.fulfill({ json: healing }));
    await page.goto('/healing');
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await page.getByRole('button', { name: 'Xác nhận áp dụng' }).click();
    await expect(page.getByText('login.submit')).toBeVisible();
  });

  test('Device Farm tạo stream chạy đã mock mà không gọi AWS', async ({ page }) => {
    await mockState(page);
    await page.route('**/api/aws?*', (route) =>
      route.fulfill({ json: { ok: true, source: 'profile' } }),
    );
    let form: Record<string, unknown> | undefined;
    await page.route('**/api/farm/run', async (route) => {
      form = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: 'text/event-stream',
        body: sse(['Đóng gói test package', 'Thu artifact']),
      });
    });
    await page.goto('/farm');
    await page.getByRole('checkbox', { name: 'Ghi video cho mỗi thiết bị' }).uncheck();
    await page.getByRole('checkbox', { name: 'Gửi secret đã cấu hình vào farm' }).check();
    await page.getByRole('button', { name: '+ Thêm biến' }).click();
    await page.getByLabel('Tên biến 1').fill('RUN_MODE');
    await page.getByLabel('Giá trị biến 1').fill('smoke');
    await page.getByRole('button', { name: 'Chạy trên Device Farm' }).click();
    await expect(page.getByText('Thu artifact')).toBeVisible();
    await expect
      .poll(() => form)
      .toMatchObject({ videoCapture: false, sendSecrets: true, env: { RUN_MODE: 'smoke' } });
  });

  test('Local Runner kiểm tra preflight trước khi stream run', async ({ page }) => {
    await mockState(page);
    await page.route('**/api/preflight?*', (route) =>
      route.fulfill({
        json: {
          platform: 'web',
          ok: true,
          checks: [{ name: 'Chromium', ok: true, detail: 'Sẵn sàng' }],
          device: 'chromium',
        },
      }),
    );
    let run: Record<string, unknown> | undefined;
    await page.route('**/api/run', async (route) => {
      run = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ contentType: 'text/event-stream', body: sse(['Mở Chromium']) });
    });
    await page.goto('/runner');
    await expect(page.getByText('Sẵn sàng chạy.')).toBeVisible();
    await page.getByRole('button', { name: 'Chạy test' }).click();
    await expect(page.getByText('Mở Chromium')).toBeVisible();
    await expect.poll(() => run?.devices).toEqual(['web:chromium']);
  });
});
