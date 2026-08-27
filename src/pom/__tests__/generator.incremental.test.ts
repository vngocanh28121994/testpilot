import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ElementRegistry, FeatureSpec, Intent, StepSpec } from '../../core/types.js';
import { generatePom } from '../generator.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function step(intent: Intent, text: string, line: number): StepSpec {
  return { keyword: line === 1 ? 'When' : 'And', intent, text, line };
}

function feature(steps: StepSpec[]): FeatureSpec {
  return {
    uri: 'features/login.feature',
    name: 'Login',
    background: [],
    scenarios: [{
      id: 'login-basic',
      name: 'Login basic',
      tags: ['@login'],
      platforms: ['web', 'android', 'ios'],
      steps,
    }],
  };
}

const registry: ElementRegistry = {
  version: 1,
  screens: { login: { id: 'login', title: 'Login' } },
  elements: {
    'login.usernameField': {
      id: 'login.usernameField',
      label: 'Username',
      screen: 'login',
      candidates: {},
    },
    'login.submitButton': {
      id: 'login.submitButton',
      label: 'Submit',
      screen: 'login',
      candidates: {},
    },
  },
};

async function outputDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-pom-'));
  tempDirs.push(dir);
  return dir;
}

test('incremental generation appends missing methods and preserves custom Page Object code', async () => {
  const output = await outputDir();
  const first = feature([
    step({ kind: 'input', element: 'login.usernameField', text: 'demo' }, 'enter username', 1),
  ]);
  await generatePom([first], registry, { outputDir: output });

  const pageFile = path.join(output, 'pages', 'LoginPage.ts');
  const original = await readFile(pageFile, 'utf8');
  const customised = original.replace(
    /\n}\s*$/,
    '\n\n  customHelper(): string { return \'keep-me\'; }\n}\n\nexport const customSentinel = true;\n',
  );
  await writeFile(pageFile, customised, 'utf8');

  const expanded = feature([
    ...first.scenarios[0]!.steps,
    step({ kind: 'tap', element: 'login.submitButton' }, 'tap submit', 2),
  ]);
  const second = await generatePom([expanded], registry, { outputDir: output });
  const merged = await readFile(pageFile, 'utf8');

  assert.match(merged, /customHelper\(\): string \{ return 'keep-me'; \}/);
  assert.match(merged, /}\n\nexport const customSentinel = true;/);
  assert.equal((merged.match(/enterUsernameField\(/g) ?? []).length, 1);
  assert.equal((merged.match(/tapSubmitButton\(/g) ?? []).length, 1);
  assert.deepEqual(second.changes.pageMethodsAdded['LoginPage.ts'], ['tapSubmitButton']);

  await generatePom([expanded], registry, { outputDir: output });
  const third = await readFile(pageFile, 'utf8');
  assert.equal((third.match(/tapSubmitButton\(/g) ?? []).length, 1);
});

test('business flows generate reusable BasePage calls instead of repeated raw steps', async () => {
  const output = await outputDir();
  const flowFeature = feature([
    step({ kind: 'ensureLoggedIn', account: 'tcbs' }, 'authenticated', 1),
    step({ kind: 'openFeatureFromSearch', query: 'Hiệu quả đầu tư' }, 'open feature', 2),
  ]);
  await generatePom([flowFeature], registry, { outputDir: output });
  const spec = await readFile(path.join(output, 'tests', 'login.spec.ts'), 'utf8');
  assert.match(spec, /ctx\.ensureLoggedIn\("tcbs"\)/);
  assert.match(spec, /ctx\.openFeatureFromSearch\("Hiệu quả đầu tư"\)/);
});

test('managed specs are refreshed from approved features and close their runtime context', async () => {
  const output = await outputDir();
  const inputOnly = feature([
    step({ kind: 'input', element: 'login.usernameField', text: 'demo' }, 'enter username', 1),
  ]);
  await generatePom([inputOnly], registry, { outputDir: output });

  const expanded = feature([
    ...inputOnly.scenarios[0]!.steps,
    step({ kind: 'tap', element: 'login.submitButton' }, 'tap submit', 2),
  ]);
  await generatePom([expanded], registry, { outputDir: output });
  const spec = await readFile(path.join(output, 'tests', 'login.spec.ts'), 'utf8');

  assert.match(spec, /^\/\/ @testpilot-managed/);
  assert.match(spec, /await loginPage\.tapSubmitButton\(\);/);
  assert.match(spec, /finally \{\n\s+await ctx\.close\(\);/);
});

test('an unmarked user-authored spec and customised driver are never overwritten', async () => {
  const output = await outputDir();
  await mkdir(path.join(output, 'tests'), { recursive: true });
  await mkdir(path.join(output, 'support'), { recursive: true });
  const specFile = path.join(output, 'tests', 'login.spec.ts');
  const driverFile = path.join(output, 'support', 'driver.ts');
  await writeFile(specFile, '// hand-written spec\n', 'utf8');
  await writeFile(driverFile, '// hand-written driver\n', 'utf8');

  const result = await generatePom([
    feature([step({ kind: 'tap', element: 'login.submitButton' }, 'tap submit', 1)]),
  ], registry, { outputDir: output });

  assert.equal(await readFile(specFile, 'utf8'), '// hand-written spec\n');
  assert.equal(await readFile(driverFile, 'utf8'), '// hand-written driver\n');
  assert.ok(result.changes.preserved.includes('login.spec.ts'));
  assert.ok(result.changes.preserved.includes('support/driver.ts'));
});

test('row actions generate one parameterized Page Object method for every row value', async () => {
  const output = await outputDir();
  const rowRegistry: ElementRegistry = {
    version: 1,
    screens: { priceBoard: { id: 'priceBoard', title: 'Price board' } },
    elements: {
      'priceBoard.rowActionMenu': {
        id: 'priceBoard.rowActionMenu',
        label: 'Icon ... tại dòng {{rowText}}',
        screen: 'priceBoard',
        template: { kind: 'rowAction', action: '...' },
        candidates: {},
      },
    },
  };
  const rowFeature: FeatureSpec = {
    uri: 'features/rows.feature',
    name: 'Rows',
    background: [],
    scenarios: [{
      id: 'rows',
      name: 'Open menus',
      tags: [],
      platforms: ['web', 'android', 'ios'],
      steps: [
        step({
          kind: 'tap',
          element: 'priceBoard.rowActionMenu',
          rowAction: { rowText: 'ADS', action: '...' },
        }, 'open ADS', 1),
        step({
          kind: 'tap',
          element: 'priceBoard.rowActionMenu',
          rowAction: { rowText: 'FPT', action: '...' },
        }, 'open FPT', 2),
      ],
    }],
  };

  await generatePom([rowFeature], rowRegistry, { outputDir: output });
  const page = await readFile(path.join(output, 'pages', 'PriceBoardPage.ts'), 'utf8');
  const spec = await readFile(path.join(output, 'tests', 'rows.spec.ts'), 'utf8');

  assert.equal((page.match(/async openRowMenu\(/g) ?? []).length, 1);
  assert.match(page, /openRowMenu\(rowText: string\)/);
  assert.match(page, /tapRowAction\('priceBoard\.rowActionMenu', rowText, '\.\.\.'\)/);
  assert.match(spec, /priceBoardPage\.openRowMenu\("ADS"\)/);
  assert.match(spec, /priceBoardPage\.openRowMenu\("FPT"\)/);
});

test('dynamic text assertions generate reusable parameterized Page Object methods', async () => {
  const output = await outputDir();
  const textRegistry: ElementRegistry = {
    version: 1,
    screens: { priceBoard: { id: 'priceBoard', title: 'Price board' } },
    elements: {
      'priceBoard.dynamicText': {
        id: 'priceBoard.dynamicText',
        label: '{{text}}',
        screen: 'priceBoard',
        template: { kind: 'text' },
        candidates: {},
      },
    },
  };
  const textFeature: FeatureSpec = {
    uri: 'features/dynamic-text.feature',
    name: 'Dynamic text',
    background: [],
    scenarios: [{
      id: 'dynamic-text',
      name: 'Reuse text',
      tags: [],
      platforms: ['web', 'android', 'ios'],
      steps: [
        step({
          kind: 'assertVisible', element: 'priceBoard.dynamicText',
          locatorParams: { text: 'ADS' },
        }, 'ADS visible', 1),
        step({
          kind: 'assertVisible', element: 'priceBoard.dynamicText',
          locatorParams: { text: 'FPT' },
        }, 'FPT visible', 2),
        step({
          kind: 'assertNotVisible', element: 'priceBoard.dynamicText',
          locatorParams: { text: 'ADS' },
        }, 'ADS absent', 3),
      ],
    }],
  };

  await generatePom([textFeature], textRegistry, { outputDir: output });
  const page = await readFile(path.join(output, 'pages', 'PriceBoardPage.ts'), 'utf8');
  const spec = await readFile(path.join(output, 'tests', 'dynamic-text.spec.ts'), 'utf8');

  assert.equal((page.match(/async assertTextVisible\(/g) ?? []).length, 1);
  assert.equal((page.match(/async assertTextNotVisible\(/g) ?? []).length, 1);
  assert.match(page, /assertTextVisible\(text: string\)/);
  assert.match(page, /assertVisible\('priceBoard\.dynamicText', \{ text: text \}\)/);
  assert.match(spec, /priceBoardPage\.assertTextVisible\("ADS"\)/);
  assert.match(spec, /priceBoardPage\.assertTextVisible\("FPT"\)/);
  assert.match(spec, /priceBoardPage\.assertTextNotVisible\("ADS"\)/);
});

test('business-region intent generates a reusable scoped Page Object method', async () => {
  const output = await outputDir();
  const scopedRegistry: ElementRegistry = {
    version: 1,
    screens: { fund: { id: 'fund', title: 'Fundmart' } },
    elements: {
      'fund.recommendedSection': {
        id: 'fund.recommendedSection',
        label: 'Các quỹ có thể bạn quan tâm',
        screen: 'fund',
        candidates: {},
      },
      'fund.oneMonth': {
        id: 'fund.oneMonth', label: '1M', screen: 'fund', candidates: {},
      },
    },
  };
  const scopedFeature: FeatureSpec = {
    uri: 'features/fund.feature',
    name: 'Fundmart',
    background: [],
    scenarios: [{
      id: 'fund-scope', name: 'Inspect recommended funds', tags: [],
      platforms: ['web', 'android', 'ios'],
      steps: [
        step({ kind: 'focusRegion', element: 'fund.recommendedSection' }, 'inspect section', 1),
        step({ kind: 'tap', element: 'fund.oneMonth' }, 'tap 1M', 2),
      ],
    }],
  };

  await generatePom([scopedFeature], scopedRegistry, { outputDir: output });
  const page = await readFile(path.join(output, 'pages', 'FundPage.ts'), 'utf8');
  const spec = await readFile(path.join(output, 'tests', 'fund.spec.ts'), 'utf8');

  assert.match(page, /async focusRecommendedSectionRegion\(\)/);
  assert.match(page, /focusRegion\('fund\.recommendedSection'\)/);
  assert.match(spec, /fundPage\.focusRecommendedSectionRegion\(\)/);
  assert.match(spec, /fundPage\.tapOneMonth\(\)/);
});

test('hover, drag-drop and directional scroll generate reusable Page Object calls', async () => {
  const output = await outputDir();
  const actionRegistry: ElementRegistry = {
    version: 1,
    screens: { board: { id: 'board', title: 'Board' } },
    elements: {
      'board.dynamicText': {
        id: 'board.dynamicText', label: '{{text}}', screen: 'board',
        template: { kind: 'text' }, candidates: {},
      },
      'board.chart': {
        id: 'board.chart', label: 'Chart', screen: 'board', candidates: {},
      },
      'board.dropZone': {
        id: 'board.dropZone', label: 'Drop zone', screen: 'board', candidates: {},
      },
    },
  };
  const actionFeature = feature([
    step({ kind: 'hover', element: 'board.chart' }, 'hover chart', 1),
    step({
      kind: 'dragDrop', source: 'board.dynamicText', target: 'board.dropZone',
      sourceLocatorParams: { text: 'ADS' },
    }, 'drag ADS', 2),
    step({ kind: 'scroll', direction: 'down' }, 'scroll down', 3),
  ]);
  actionFeature.uri = 'features/actions.feature';
  actionFeature.name = 'Actions';

  await generatePom([actionFeature], actionRegistry, { outputDir: output });
  const page = await readFile(path.join(output, 'pages', 'BoardPage.ts'), 'utf8');
  const spec = await readFile(path.join(output, 'tests', 'actions.spec.ts'), 'utf8');

  assert.match(page, /async hoverChart\(\)/);
  assert.match(page, /async dragTextToDropZone\(sourceText: string\)/);
  assert.match(page, /dragDrop\('board\.dynamicText', 'board\.dropZone', \{ text: sourceText \}, undefined\)/);
  assert.match(spec, /boardPage\.hoverChart\(\)/);
  assert.match(spec, /boardPage\.dragTextToDropZone\("ADS"\)/);
  assert.match(spec, /ctx\.scroll\("down"\)/);
});

test('date selection and numeric assertion generate typed reusable Page Object calls', async () => {
  const output = await outputDir();
  const metricRegistry: ElementRegistry = {
    version: 1,
    screens: { stats: { id: 'stats', title: 'Statistics' } },
    elements: {
      'stats.fromDate': {
        id: 'stats.fromDate', label: 'Ngày Từ', screen: 'stats', candidates: {},
        controlType: 'date',
      },
      'stats.transactionCount': {
        id: 'stats.transactionCount', label: 'số lượng giao dịch', screen: 'stats', candidates: {},
      },
    },
  };
  const metricFeature = feature([
    step({ kind: 'input', element: 'stats.fromDate', text: '01/01/2026' }, 'generic date input', 1),
    step({
      kind: 'assertNumber', element: 'stats.transactionCount', operator: 'notEquals', value: 0,
    }, 'assert transaction count', 2),
  ]);
  metricFeature.uri = 'features/statistics.feature';
  metricFeature.name = 'Statistics';

  await generatePom([metricFeature], metricRegistry, { outputDir: output });
  const page = await readFile(path.join(output, 'pages', 'StatsPage.ts'), 'utf8');
  const spec = await readFile(path.join(output, 'tests', 'statistics.spec.ts'), 'utf8');

  assert.match(page, /async selectDateFromDate\(date: string\)/);
  assert.match(page, /this\.page\.selectDate\('stats\.fromDate', date\)/);
  assert.match(page, /async assertTransactionCountNumber\(operator: 'equals' \| 'notEquals' \| 'greaterThan' \| 'atLeast' \| 'atMost', expected: number\)/);
  assert.match(page, /this\.page\.assertNumber\('stats\.transactionCount', operator, expected\)/);
  assert.match(spec, /statsPage\.selectDateFromDate\("01\/01\/2026"\)/);
  assert.match(spec, /statsPage\.assertTransactionCountNumber\("notEquals", 0\)/);
});

test('replaces a generated method an older generator named differently', async () => {
  const output = await outputDir();
  await mkdir(path.join(output, 'pages'), { recursive: true });
  // Written by an earlier generator: the marker is current, the method name is
  // not, and the body does the wrong thing. The spec calls the current name, so
  // matching on the marker alone left the project unable to compile.
  await writeFile(path.join(output, 'pages', 'LoginPage.ts'), [
    "import { BasePage } from './BasePage.js';",
    '',
    'export class LoginPage extends BasePage {',
    '  /** Submit',
    '   * @testpilot-element login.submitButton action=assertVisible',
    '   */',
    '  async doSubmitButton(): Promise<void> {',
    "    await this.page.tap('login.submitButton');",
    '  }',
    '',
    '  /** Người viết tự thêm, không mang marker — không được đụng tới. */',
    '  async myOwnHelper(): Promise<void> {',
    '    /* giữ nguyên */',
    '  }',
    '}',
    '',
  ].join('\n'), 'utf8');

  const out = await generatePom(
    [feature([step({ kind: 'assertVisible', element: 'login.submitButton' }, 'Then "Submit" is visible', 1)])],
    registry,
    { outputDir: output, platform: 'web' },
  );

  const code = await readFile(path.join(output, 'pages', 'LoginPage.ts'), 'utf8');
  assert.match(code, /async assertSubmitButtonVisible\(/, 'phải dùng tên hiện hành');
  assert.ok(!code.includes('doSubmitButton'), 'tên cũ phải biến mất, không để lại bản trùng');
  // The stale body tapped where the action asserts; renaming alone would have
  // left that wrong behaviour in place under a correct-looking name.
  assert.match(code, /assertVisible\('login\.submitButton'\)/);
  assert.ok(!code.includes("tap('login.submitButton')"), 'thân hàm sai phải bị thay');
  assert.match(code, /myOwnHelper/, 'code người viết phải còn nguyên');
  assert.deepEqual(out.changes.pageMethodsAdded['LoginPage.ts'], ['assertSubmitButtonVisible']);
});

test('leaves a hand-edited body alone when the name is already current', async () => {
  const output = await outputDir();
  await mkdir(path.join(output, 'pages'), { recursive: true });
  await writeFile(path.join(output, 'pages', 'LoginPage.ts'), [
    "import { BasePage } from './BasePage.js';",
    '',
    'export class LoginPage extends BasePage {',
    '  /** Submit',
    '   * @testpilot-element login.submitButton action=assertVisible',
    '   */',
    '  async assertSubmitButtonVisible(): Promise<void> {',
    '    /* chỉnh tay: chờ thêm trước khi khẳng định */',
    "    await this.page.assertVisible('login.submitButton');",
    '  }',
    '}',
    '',
  ].join('\n'), 'utf8');

  const out = await generatePom(
    [feature([step({ kind: 'assertVisible', element: 'login.submitButton' }, 'Then "Submit" is visible', 1)])],
    registry,
    { outputDir: output, platform: 'web' },
  );

  const code = await readFile(path.join(output, 'pages', 'LoginPage.ts'), 'utf8');
  assert.match(code, /chỉnh tay: chờ thêm trước khi khẳng định/, 'không được ghi đè chỉnh sửa tay');
  assert.ok(out.changes.preserved.includes('LoginPage.ts'));
});
