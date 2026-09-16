/**
 * Kịch bản XANH cũng phải để lại bằng chứng.
 *
 * Trước đây một bước assert xanh chỉ để lại `{status: passed, durationMs: 84,
 * attempts: 1}` — nói rằng đã tìm thấy, không nói thấy cái gì. Ca đỏ thì có ảnh,
 * cây DOM và video. Một bộ test chỉ chứng minh được phần hỏng của mình thì phần
 * xanh của nó chỉ là lời hứa.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Registry } from '../../core/registry.js';
import type { LocatorCandidate, ScenarioSpec } from '../../core/types.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import { Resolver } from '../resolver.js';
import { Executor, isVerificationIntent } from '../executor.js';

const CHU_TREN_MAN_HINH = 'MEL-HNX';

function kichBan(steps: ScenarioSpec['steps']): ScenarioSpec {
  return { id: 'bang-chung', name: 'Bằng chứng ca xanh', tags: [], platforms: ['web'], steps };
}

async function chay(daChup: string[]) {
  const registry = await Registry.load('/dev/null/nonexistent-bang-chung.json');
  registry.upsertElement({
    id: 'man.goiY', label: 'Danh sách gợi ý', screen: 'man',
    candidates: { web: [{ strategy: 'css', value: '.goi-y', weight: 0.9, origin: 'authored' }] },
  });
  const handle = {
    text: async () => CHU_TREN_MAN_HINH,
    isVisible: async () => true,
    isEnabled: async () => true,
    getAttribute: async () => null,
    value: async () => '',
  } as unknown as UiHandle;
  const driver = {
    platform: 'web', device: 'mock-web',
    start: async () => {}, stop: async () => {}, launch: async () => {},
    find: async (c: LocatorCandidate) => (c.value === '.goi-y' ? handle : null),
    tap: async () => {}, longPress: async () => {}, input: async () => {}, clear: async () => {},
    selectOption: async () => {}, scrollIntoView: async () => {}, swipe: async () => {},
    scroll: async () => {}, back: async () => {}, isIdle: async () => true,
    screenshot: async (stem: string) => { daChup.push(stem); return stem; },
  } as unknown as UiDriver;
  const resolver = new Resolver(driver, registry, {
    timeoutMs: 40, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
  });
  const executor = new Executor(driver, resolver, { retries: 0, screenshotOnFailure: true });
  return executor.runScenario(kichBan([
    {
      keyword: 'Then', line: 12, text: '"Danh sách gợi ý" is visible',
      intent: { kind: 'assertVisible', element: 'man.goiY' },
    },
  ]));
}

describe('bằng chứng của kịch bản xanh', () => {
  it('áp dụng chính sách chụp cho mọi loại kiểm chứng, không phụ thuộc từng case cụ thể', () => {
    const verificationKinds = [
      'focusRegion', 'waitFor', 'assertVisible', 'assertNotVisible', 'assertOption',
      'assertText', 'assertNumber', 'assertNumberDelta', 'assertCollection',
    ] as const;
    for (const kind of verificationKinds) {
      assert.equal(isVerificationIntent({ kind } as never), true, `${kind} bị bỏ sót`);
    }

    const actionKinds = [
      'launch', 'ensureLoggedIn', 'openFeatureFromSearch', 'tap', 'hover', 'dragDrop',
      'longPress', 'input', 'selectDate', 'clear', 'select', 'scrollTo', 'swipe',
      'scroll', 'back', 'simulateBiometricSuccess', 'injectCameraImage',
      'rememberNumber', 'screenshot',
    ] as const;
    for (const kind of actionKinds) {
      assert.equal(isVerificationIntent({ kind } as never), false, `${kind} không phải assertion`);
    }
  });

  it('bước assert ghi lại locator thắng và chữ đọc được', async () => {
    const ketQua = await chay([]);
    const buoc = ketQua.runs[0]!.steps[0]!;
    assert.equal(buoc.status, 'passed');
    assert.ok(buoc.evidence, 'bước xanh phải mang bằng chứng');
    assert.equal(buoc.evidence!.locator, 'css=.goi-y');
    assert.equal(buoc.evidence!.saw, CHU_TREN_MAN_HINH);
  });

  it('lượt chạy xanh để lại đúng MỘT ảnh tại bước kiểm tra', async () => {
    const daChup: string[] = [];
    const ketQua = await chay(daChup);
    assert.equal(ketQua.runs[0]!.status, 'passed');
    assert.ok(ketQua.runs[0]!.proof, 'lượt xanh phải có ảnh chứng minh');
    assert.equal(daChup.length, 1, `chụp ${daChup.length} ảnh: ${daChup.join(', ')}`);
    assert.match(daChup[0]!, /-pass$/);
  });

  it('giữ ảnh toast tại assertion dù bước sau làm toast biến mất', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-toast-proof.json');
    registry.upsertElement({
      id: 'transfer.thongBao', label: 'Thông báo chuyển tiền', screen: 'transfer',
      candidates: { web: [{ strategy: 'css', value: '.toast', weight: 1, origin: 'authored' }] },
    });
    let toastVisible = true;
    const shots: string[] = [];
    const handle = {
      candidate: { strategy: 'css', value: '.toast', weight: 1, origin: 'authored' },
      text: async () => 'Chuyển tiền thành công',
      isVisible: async () => toastVisible,
      isEnabled: async () => true,
      getAttribute: async () => null,
      value: async () => '',
    } as unknown as UiHandle;
    const driver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {},
      launch: async () => { toastVisible = false; },
      find: async () => toastVisible ? handle : null,
      tap: async () => {}, longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {}, swipe: async () => {},
      scroll: async () => {}, back: async () => {}, isIdle: async () => true,
      screenshot: async () => {
        const path = toastVisible ? 'toast-visible.png' : 'toast-gone.png';
        shots.push(path);
        return path;
      },
    } as unknown as UiDriver;
    const executor = new Executor(driver, new Resolver(driver, registry, {
      timeoutMs: 40, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    }), { retries: 0, screenshotOnFailure: true });

    const result = await executor.runScenario(kichBan([
      {
        keyword: 'Then', line: 20, text: '"Thông báo chuyển tiền" shows "Chuyển tiền thành công"',
        intent: { kind: 'assertText', element: 'transfer.thongBao', text: 'Chuyển tiền thành công', mode: 'contains' },
      },
      { keyword: 'And', line: 21, text: 'I open the app', intent: { kind: 'launch' } },
    ]));

    assert.equal(result.runs[0]?.proof, 'toast-visible.png');
    assert.deepEqual(shots, ['toast-visible.png'], 'không được đợi đến cuối scenario mới chụp');
  });

  /**
   * Bằng chứng thu tại lúc resolve chứ không phải sau khi bước xong, và phải
   * xoá ở đầu mỗi bước: để sót của bước trước thì report gán chứng cứ cho bước
   * sai — tệ hơn hẳn việc không có chứng cứ.
   */
  it('bước không assert thì không mượn bằng chứng của bước trước', async () => {
    const registry = await Registry.load('/dev/null/nonexistent-bang-chung-2.json');
    registry.upsertElement({
      id: 'man.goiY', label: 'Danh sách gợi ý', screen: 'man',
      candidates: { web: [{ strategy: 'css', value: '.goi-y', weight: 0.9, origin: 'authored' }] },
    });
    const handle = {
      text: async () => CHU_TREN_MAN_HINH, isVisible: async () => true,
      isEnabled: async () => true, getAttribute: async () => null, value: async () => '',
    } as unknown as UiHandle;
    const driver = {
      platform: 'web', device: 'mock-web',
      start: async () => {}, stop: async () => {}, launch: async () => {},
      find: async (c: LocatorCandidate) => (c.value === '.goi-y' ? handle : null),
      tap: async () => {}, longPress: async () => {}, input: async () => {}, clear: async () => {},
      selectOption: async () => {}, scrollIntoView: async () => {}, swipe: async () => {},
      scroll: async () => {}, back: async () => {}, isIdle: async () => true,
      screenshot: async () => 'anh',
    } as unknown as UiDriver;
    const resolver = new Resolver(driver, registry, {
      timeoutMs: 40, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
    });
    const executor = new Executor(driver, resolver, { retries: 0, screenshotOnFailure: true });
    const ketQua = await executor.runScenario(kichBan([
      {
        keyword: 'Then', line: 12, text: '"Danh sách gợi ý" is visible',
        intent: { kind: 'assertVisible', element: 'man.goiY' },
      },
      { keyword: 'And', line: 13, text: 'I open the app', intent: { kind: 'launch' } },
    ]));
    assert.ok(ketQua.runs[0]!.steps[0]!.evidence, 'bước assert vẫn phải có');
    assert.equal(ketQua.runs[0]!.steps[1]!.evidence, undefined, 'bước launch không được mượn');
  });
});
