import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LocatorCandidate, ScenarioSpec } from '../../core/types.js';
import { Registry } from '../../core/registry.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import { Resolver } from '../resolver.js';
import { Executor } from '../executor.js';

/**
 * Cú bấm bị chính kết quả của nó che: khi nào lỗi interception là BẰNG CHỨNG,
 * và khi nào nó không nói lên điều gì.
 *
 * Ba tình huống dưới đây để lại cùng một dấu vết ở mọi tín hiệu khác — điều
 * kiện đã thoả sẵn từ trước, nội dung không đổi, driver ném lỗi bấm. Thứ duy
 * nhất tách chúng ra là câu hỏi hỏi TRƯỚC cú bấm: phần tử có bấm tới được
 * không. Trước đó phần tử còn bấm được mà sau đó bị chắn thì chỉ cú bấm giải
 * thích được; còn bị chắn sẵn từ đầu thì một dialog bỏ quên từ bước trước cũng
 * ném đúng lỗi ấy.
 */

const INTERCEPTED = 'locator.click: Timeout 5000ms exceeded. '
  + '<div class="cdk-overlay-container"> subtree intercepts pointer events';

function handle(candidate: LocatorCandidate): UiHandle {
  return { candidate, isVisible: async () => true, text: async () => '' };
}

function scenario(): ScenarioSpec {
  return {
    id: 'covered-tap', name: 'Cú bấm bị kết quả của nó che', tags: [], platforms: ['web'],
    steps: [
      { keyword: 'When', text: 'I click "more"', line: 1, intent: { kind: 'tap', element: 'p.more' } },
      { keyword: 'Then', text: '"remove" is visible', line: 2, intent: { kind: 'assertVisible', element: 'p.remove' } },
    ],
  };
}

async function registryWithBoth(name: string): Promise<Registry> {
  const registry = await Registry.load(`/dev/null/nonexistent-${name}.json`);
  for (const [id, value] of [['p.more', 'more'], ['p.remove', 'remove']] as const) {
    registry.upsertElement({
      id, label: value, screen: 'p',
      candidates: { web: [{ strategy: 'testId', value, weight: 0.95, origin: 'authored' }] },
    });
  }
  return registry;
}

function driverWith(
  overrides: Partial<UiDriver> & { tap: UiDriver['tap'] },
): UiDriver {
  return {
    platform: 'web', device: 'mock-web',
    start: async () => {}, stop: async () => {}, launch: async () => {},
    find: async (candidate) => handle(candidate),
    longPress: async () => {}, input: async () => {}, clear: async () => {},
    selectOption: async () => {}, scrollIntoView: async () => {},
    swipe: async () => {}, scroll: async () => {}, back: async () => {},
    screenshot: async () => '', isIdle: async () => true,
    ...overrides,
  };
}

async function run(registry: Registry, driver: UiDriver) {
  const resolver = new Resolver(driver, registry, {
    timeoutMs: 100, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
  });
  const executor = new Executor(driver, resolver, {
    retries: 0, screenshotOnFailure: false, postconditionTimeoutMs: 80, variables: {},
  });
  const result = await executor.runScenario(scenario(), []);
  return { result, tapStep: result.runs[0]?.steps[0] };
}

describe('Executor — bằng chứng của một cú bấm bị che', () => {
  it('bấm được trước, bị chắn sau: cú bấm được ghi nhận, không còn cờ chưa chứng minh', async () => {
    const registry = await registryWithBoth('covered-proof');
    let taps = 0;
    const driver = driverWith({
      // Trước cú bấm phần tử còn nhận được con trỏ. Sau đó lớp phủ mới xuất
      // hiện — và lớp phủ ấy chính là menu mà cú bấm mở ra.
      isHittable: async () => taps === 0,
      tap: async () => { taps += 1; throw new Error(INTERCEPTED); },
    });

    const { result, tapStep } = await run(registry, driver);

    assert.equal(result.verdict, 'passed');
    assert.equal(taps, 1, 'không bấm lại: cú bấm đầu đã trúng');
    assert.notEqual(tapStep?.status, 'unverified', 'đã có bằng chứng thì không mang cờ');
    assert.equal(tapStep?.unverifiedKind, undefined);
  });

  it('bị chắn sẵn từ trước: vẫn là chưa chứng minh được, và kịch bản đỏ', async () => {
    // Một dialog bỏ quên từ bước trước chắn mọi thứ. Cú bấm ném đúng lỗi
    // interception như ca trên, "remove" cũng đang hiện — nhưng nó hiện từ
    // trước, và không có gì phân biệt "đã bấm" với "không bấm được gì".
    const registry = await registryWithBoth('covered-preexisting');
    const driver = driverWith({
      isHittable: async () => false,
      tap: async () => { throw new Error(INTERCEPTED); },
    });

    const { result, tapStep } = await run(registry, driver);

    assert.equal(result.verdict, 'failed', 'lớp phủ có sẵn không chứng minh được gì');
    assert.equal(tapStep?.status, 'unverified');
    assert.equal(tapStep?.unverifiedKind, 'unchanged');
  });

  it('driver không hit-test được: cảnh báo, nhưng không kết luận theo chiều nào', async () => {
    // Appium chưa trả lời được câu hỏi này. Khoảng trống của công cụ đo không
    // phải bằng chứng thao tác hỏng, nên bước mang cờ `covered` để hiện trong
    // báo cáo mà không kéo kịch bản đỏ.
    const registry = await registryWithBoth('covered-unmeasured');
    const driver = driverWith({
      tap: async () => { throw new Error(INTERCEPTED); },
    });

    const { result, tapStep } = await run(registry, driver);

    assert.equal(result.verdict, 'passed');
    assert.equal(tapStep?.status, 'unverified');
    assert.equal(tapStep?.unverifiedKind, 'covered');
  });

  it('lỗi bấm không phải kiểu bị chắn thì không được mượn kết luận', async () => {
    // "Element is not attached to the DOM" nói rằng không có gì để bấm, không
    // nói rằng có thứ gì đó chắn đường. Mượn kết luận ở đây là mở lại đúng cái
    // cửa mà cả cơ chế này sinh ra để đóng.
    const registry = await registryWithBoth('covered-other-error');
    const driver = driverWith({
      isHittable: async () => true,
      tap: async () => { throw new Error('locator.click: Element is not attached to the DOM'); },
    });

    const { result, tapStep } = await run(registry, driver);

    assert.equal(result.verdict, 'failed');
    assert.equal(tapStep?.unverifiedKind, 'unchanged');
  });
});
