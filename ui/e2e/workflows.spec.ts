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

  test('Studio lưu môi trường mới, role và build theo môi trường', async ({ page }) => {
    await mockState(page);
    await page.route('**/api/models', (route) =>
      route.fulfill({ json: { models: [], live: false, auto: 'claude-sonnet' } }),
    );
    await page.route('**/api/app/upload?*', (route) =>
      route.fulfill({ json: { path: 'build/uat/app.apk' } }),
    );
    let saved: Record<string, unknown> | undefined;
    await page.route('**/api/studio/save', async (route) => {
      saved = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ok: true, accounts: state.accounts } });
    });
    await page.goto('/studio');
    await page.getByPlaceholder('Tên môi trường mới, ví dụ uat').fill('uat');
    await page.getByRole('button', { name: 'Thêm môi trường' }).click();
    const env = page.getByLabel('Tên môi trường uat').locator('xpath=ancestor::section[1]');
    await env.getByRole('combobox').selectOption('khach-hang');
    await env
      .locator('input[type=file]')
      .first()
      .setInputFiles({
        name: 'app.apk',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('apk'),
      });
    await page.getByRole('button', { name: 'Lưu (không chạy)' }).click();
    await expect.poll(() => saved?.defaultEnv).toBe('sit');
    await expect
      .poll(() => (saved?.environments as Record<string, unknown>)?.uat)
      .toMatchObject({
        accounts: { 'khach-hang': 'khach-hang' },
        android: { app: 'build/uat/app.apk' },
      });
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

  test('Scenario Review thêm rồi xoá kịch bản qua editor một-kịch-bản', async ({ page }) => {
    await mockState(page);
    const writes: Array<Record<string, unknown>> = [];
    await page.route('**/api/feature/normalize', async (route) => {
      const body = route.request().postDataJSON() as { content: string };
      await route.fulfill({
        json: {
          content: body.content,
          changes: [],
          unresolved: [],
          valid: true,
          usedAi: false,
          discoveredLater: [],
          actionProposals: [],
          appliedActions: [],
          actionAnalysis: { available: true, attempted: true },
          scenarioPlan: {
            source: 'deterministic',
            goal: 'Kịch bản',
            preconditions: [],
            reusableFlows: [],
            steps: [],
            warnings: [],
          },
        },
      });
    });
    await page.route('**/api/feature', async (route) => {
      writes.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { ok: true, revision: 'r2' } });
    });
    await page.goto('/scenarios');

    await page.getByRole('button', { name: 'Thêm kịch bản' }).click();
    await page.getByRole('combobox', { name: 'Feature đích' }).selectOption('dang-nhap.feature');
    await page
      .getByLabel('Nội dung kịch bản')
      .fill('Scenario: Kịch bản mới\n  Given I open the app');
    await page.getByRole('button', { name: 'Thêm kịch bản' }).last().click();
    await expect.poll(() => writes[0]?.content).toContain('Scenario: Kịch bản mới');

    await page.getByRole('button', { name: 'Xoá Đăng nhập thành công' }).click();
    await page.getByRole('button', { name: 'Xoá kịch bản' }).click();
    await expect.poll(() => writes[1]?.content).not.toContain('Scenario: Đăng nhập thành công');
  });

  test('Local Runner gửi hai thiết bị đã chọn để chạy song song', async ({ page }) => {
    const parallelState = structuredClone(state);
    parallelState.config.android = {
      deviceName: 'Pixel 7',
      hybrid: false,
      isolation: 'none',
      devices: [
        { id: 'pixel-7', deviceName: 'Pixel 7', udid: 'android-7', systemPort: 8201 },
        { id: 'pixel-8', deviceName: 'Pixel 8', udid: 'android-8', systemPort: 8202 },
      ],
    };
    await page.route('**/api/state', (route) => route.fulfill({ json: parallelState }));
    await page.route('**/api/preflight?*', (route) =>
      route.fulfill({ json: { platform: 'android', ok: true, checks: [] } }),
    );
    await page.route('**/api/prereq/appium/status', (route) =>
      route.fulfill({ json: { running: false, managed: false } }),
    );
    let run: Record<string, unknown> | undefined;
    await page.route('**/api/run', async (route) => {
      run = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ contentType: 'text/event-stream', body: sse(['Mở hai thiết bị']) });
    });
    await page.goto('/runner');
    await page.getByLabel('Platform').selectOption('android');
    await page.getByRole('checkbox', { name: 'Chọn Pixel 7' }).check();
    await page.getByRole('checkbox', { name: 'Chọn Pixel 8' }).check();
    await page.getByRole('button', { name: 'Chạy test' }).click();
    await expect.poll(() => run?.devices).toEqual(['android:pixel-7', 'android:pixel-8']);
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
    await page.getByLabel('Lọc tag Device Farm').fill('@web');
    await page.getByLabel('Lọc tag Device Farm').press('Enter');
    await page.getByRole('button', { name: 'Chạy trên Device Farm' }).click();
    // Nhắm vào console, không nhắm vào cả trang: "Thu artifact" giờ vừa là một
    // dòng log vừa là tên stage thứ tư trong thanh tiến trình.
    await expect(page.locator('pre.console')).toContainText('Thu artifact');
    await expect
      .poll(() => form)
      .toMatchObject({
        videoCapture: false,
        sendSecrets: true,
        env: { RUN_MODE: 'smoke', TESTPILOT_TAG: '@web' },
      });
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
