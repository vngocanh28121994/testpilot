import { expect, test, type Page } from '@playwright/test';

/**
 * Vòng đời đầy đủ của một workflow, đúng mắt xích đã đứt trên bản React:
 * Studio sinh xong → dẫn sang gate → duyệt kịch bản → bấm hoàn thành → chạy.
 *
 * Bản cũ làm việc này ở app.js:903 (`navigate('scenario-review', runId)`) và
 * app.js:2029 (`completeActiveWorkflow`). Trước đợt này bản React dừng lại sau
 * bước đầu tiên và không có gì nói phải đi đâu tiếp.
 */

const RUN_ID = 'wf-e2e-1';

const baseConfig = {
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
  farm: {},
  llm: { model: 'auto', note: '' },
  sources: ['https://example.com/spec'],
  targetFeature: 'Đăng nhập',
};

const stages = [
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

/**
 * State CÓ THỂ THAY ĐỔI: duyệt một kịch bản phải thực sự mở khoá nút hoàn
 * thành. Một fixture bất biến sẽ nghiệm thu một cái nút vốn không bao giờ đổi
 * trạng thái — tức là không nghiệm thu gì cả.
 */
function makeState(reviews: Record<string, 'pending' | 'approved' | 'rejected'>) {
  return {
    config: baseConfig,
    configError: null,
    configFile: '/tmp/testpilot.config.json',
    elements: 4,
    features: [
      {
        name: 'dang-nhap.feature',
        content: 'Feature: Đăng nhập\n',
        revision: 'r1',
        feature: 'Đăng nhập',
        background: [],
        scenarios: Object.entries(reviews).map(([name, status]) => ({
          name,
          tags: ['@web'],
          platforms: ['web'],
          steps: 3,
          stepTexts: [],
          review: { status },
        })),
        coverage: {
          decision: 'incomplete',
          total: 3,
          covered: 2,
          missing: [{ id: 'RQ-03', rule: 'Khoá tài khoản sau 5 lần sai', sourceQuote: '' }],
          auditedAt: '2026-08-27T10:00:00.000Z',
        },
        error: null,
      },
    ],
    reports: [],
    runs: [
      {
        id: RUN_ID,
        feature: 'Đăng nhập',
        kind: 'workflow',
        startedAt: '2026-08-27T09:00:00.000Z',
        status: 'waiting_review',
        stages,
        stagesDone: 5,
        log: [],
        generatedFile: 'dang-nhap.feature',
        generated: { scenarios: 2, steps: 7, screens: 1, elements: 12 },
        questions: [],
      },
    ],
    accounts: [{ label: 'khach-hang', username: 'user@example.com', hasPassword: true }],
    hasApiKey: true,
    modelKeys: { deepseek: false, gemini: false, anthropic: true },
    appBuilds: { android: null, ios: null },
    deviceEnv: {},
    envBuilds: {},
    tagTaxonomy: { version: 1, definitions: [], featurePattern: '@feature-<ten>' },
  };
}

function frames(items: Array<[string, unknown]>) {
  return items
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

async function mock(page: Page) {
  const reviews: Record<string, 'pending' | 'approved' | 'rejected'> = {
    'Đăng nhập thành công': 'pending',
    'Sai mật khẩu': 'pending',
  };

  await page.route('**/api/state', (route) => route.fulfill({ json: makeState(reviews) }));
  await page.route('**/api/history', (route) => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/feature/review', async (route) => {
    const body = route.request().postDataJSON() as { scenarioName: string; decision: string };
    reviews[body.scenarioName] = body.decision === 'approve' ? 'approved' : 'rejected';
    await route.fulfill({ json: { ok: true } });
  });
  return { reviews };
}

test.describe('Workflow Gate — đóng vòng từ Studio tới lượt chạy', () => {
  test('sinh xong thì dẫn sang gate, duyệt hết rồi chạy tiếp được', async ({ page }) => {
    await mock(page);

    await page.route('**/api/gen', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: frames([
          ['log', 'Đọc tài liệu nguồn'],
          [
            'run',
            {
              id: RUN_ID,
              kind: 'workflow',
              feature: 'Đăng nhập',
              status: 'waiting_review',
              startedAt: '2026-08-27T09:00:00.000Z',
              log: [],
              stages,
              generatedFile: 'dang-nhap.feature',
            },
          ],
          ['done', { ok: true }],
        ]),
      }),
    );

    let completedRunId: string | undefined;
    await page.route('**/api/workflow/complete', async (route) => {
      completedRunId = (route.request().postDataJSON() as { runId: string }).runId;
      await route.fulfill({
        contentType: 'text/event-stream',
        body: frames([
          ['log', 'Chuẩn bị môi trường automation'],
          ['log', '✓ Đã chạy 1 testcase.'],
          ['done', { ok: true }],
        ]),
      });
    });

    // 1. Sinh kịch bản ở Studio.
    await page.goto('/studio');
    await page.getByRole('button', { name: 'Bắt đầu chạy workflow' }).click();

    // 2. Bị dẫn thẳng sang màn Kịch bản, đúng lượt chạy và đúng file.
    await page.waitForURL(/\/scenarios\?.*runId=wf-e2e-1/);
    expect(page.url()).toContain('file=dang-nhap.feature');

    const gate = page.getByRole('region', { name: 'Workflow đang chờ review' });
    await expect(gate).toBeVisible();
    await expect(gate.getByText(/2 testcase · 7 bước/)).toBeVisible();

    // 3. Coverage thiếu được nói ra, nhưng không chặn review.
    await expect(gate.getByText('Coverage cần bổ sung trước khi chạy')).toBeVisible();
    await expect(gate.getByText('RQ-03')).toBeVisible();

    // 4. Còn kịch bản chờ duyệt ⇒ nút khoá, và nói ra lý do.
    const complete = gate.getByRole('button', { name: /Hoàn thành kịch bản/ });
    await expect(complete).toBeDisabled();
    await expect(gate.getByText('Còn 2 chờ duyệt · 0 đã duyệt · 0 không duyệt')).toBeVisible();

    // 5. Duyệt một, từ chối một — vẫn hợp lệ để chạy tiếp.
    const rows = page.getByRole('row');
    await rows
      .filter({ hasText: 'Đăng nhập thành công' })
      .getByRole('button', { name: 'Duyệt', exact: true })
      .click();
    await rows
      .filter({ hasText: 'Sai mật khẩu' })
      .getByRole('button', { name: 'Không duyệt', exact: true })
      .click();

    await expect(complete).toBeEnabled();
    await expect(gate.getByText(/1 testcase sẽ được chạy · 1 testcase bị loại/)).toBeVisible();

    // 6. Chạy tiếp — đúng runId đi lên server.
    await complete.click();
    await expect(gate.getByText('✓ Đã chạy 1 testcase.')).toBeVisible();
    expect(completedRunId).toBe(RUN_ID);
  });

  test('trả lời câu hỏi rồi workflow chạy tiếp', async ({ page }) => {
    const reviews: Record<string, 'pending' | 'approved' | 'rejected'> = {
      'Đăng nhập thành công': 'approved',
      'Sai mật khẩu': 'approved',
    };
    const state = makeState(reviews);
    state.runs[0]!.status = 'waiting_input';
    state.runs[0]!.questions = [
      {
        id: 'q1',
        kind: 'radio',
        prompt: 'Danh mục nào là mặc định?',
        rationale: 'Tài liệu nhắc hai danh mục mà không nói cái nào mở sẵn.',
        options: ['Danh mục của tôi', 'Danh mục đề xuất'],
        source: 'generation',
      },
    ] as never;

    await page.route('**/api/state', (route) => route.fulfill({ json: state }));
    await page.route('**/api/history', (route) => route.fulfill({ json: { runs: [] } }));

    let answers: unknown;
    await page.route('**/api/workflow/answers', async (route) => {
      answers = route.request().postDataJSON();
      await route.fulfill({ json: { remaining: 0, status: 'running' } });
    });

    await page.goto(`/scenarios?runId=${RUN_ID}`);
    const gate = page.getByRole('region', { name: 'Workflow đang chờ review' });
    await expect(gate.getByText('Cần bạn quyết định')).toBeVisible();
    // Lý do phải đứng cạnh câu hỏi: không có nó thì câu hỏi bị trả lời bừa.
    await expect(
      gate.getByText('Tài liệu nhắc hai danh mục mà không nói cái nào mở sẵn.'),
    ).toBeVisible();

    await gate.getByRole('radio', { name: 'Danh mục của tôi' }).check();
    await gate.getByRole('button', { name: 'Bổ sung thông tin và chạy tiếp' }).click();

    await expect
      .poll(() => answers)
      .toMatchObject({
        runId: RUN_ID,
        answers: [{ id: 'q1', values: ['Danh mục của tôi'] }],
      });
  });
});
