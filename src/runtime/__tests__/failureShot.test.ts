/**
 * Một khoảnh khắc hỏng chỉ chụp một bức ảnh.
 *
 * Hai chỗ cùng chụp cùng một lúc: nhánh thoát khi bấm lỗi ("cú bấm này có tạo
 * ra kết quả mong đợi không?"), rồi handler của bước hỏng. Trên một lượt chạy
 * thật hai file ra cùng dấu giây 03:09:59, 256 686 và 256 738 byte, cùng một
 * màn hình — mỗi ca fail trả giá hai lần cho một bức ảnh, và report hiện nó
 * hai lần liền nhau. Một lượt 4 ca fail để lại 24 MB artefact.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Registry } from '../../core/registry.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import type { LocatorCandidate, ScenarioSpec } from '../../core/types.js';
import { Resolver } from '../resolver.js';
import { Executor } from '../executor.js';

function kichBan(steps: ScenarioSpec['steps']): ScenarioSpec {
  return { id: 'anh-hong', name: 'Ảnh lúc hỏng', tags: [], platforms: ['web'], steps };
}

/** Driver mà mọi cú bấm đều ném lỗi — đường đi thẳng vào nhánh thoát. */
function driverBamHong(daChup: string[]): UiDriver {
  const handle = (value: string): UiHandle => ({
    text: async () => '',
    isVisible: async () => true,
    isEnabled: async () => true,
    getAttribute: async () => null,
    value: async () => '',
    candidate: { strategy: 'testId', value },
  } as unknown as UiHandle);
  return {
    platform: 'web', device: 'mock-web',
    start: async () => {}, stop: async () => {}, launch: async () => {},
    find: async (c: LocatorCandidate) => (c.value === 'nut' ? handle(c.value) : null),
    tap: async () => { throw new Error('locator.click: Timeout 5000ms exceeded.'); },
    longPress: async () => {}, input: async () => {}, clear: async () => {},
    selectOption: async () => {}, scrollIntoView: async () => {}, swipe: async () => {},
    scroll: async () => {}, back: async () => {}, isIdle: async () => true,
    screenshot: async (stem: string) => { daChup.push(stem); return stem; },
  } as unknown as UiDriver;
}

async function chay(daChup: string[]) {
  const registry = await Registry.load('/dev/null/nonexistent-anh-hong.json');
  registry.upsertElement({
    id: 'man.nut', label: 'Nút', screen: 'man',
    candidates: { web: [{ strategy: 'testId', value: 'nut', weight: 0.9, origin: 'authored' }] },
  });
  // Hậu điều kiện phải là thứ KHÔNG bao giờ thấy được. Trỏ nó vào chính cái nút
  // đang tìm thấy thì nhánh thoát kết luận "cú bấm đã trúng" và bước ra
  // `unverified` — không có ảnh nào được chụp, tức không đo được cái cần đo.
  registry.upsertElement({
    id: 'man.xong', label: 'Xong', screen: 'man',
    candidates: { web: [{ strategy: 'testId', value: 'xong', weight: 0.9, origin: 'authored' }] },
  });
  const driver = driverBamHong(daChup);
  const resolver = new Resolver(driver, registry, {
    timeoutMs: 40, pollMs: 5, requireVisible: true, verifyHealedMatch: false,
  });
  const executor = new Executor(driver, resolver, {
    retries: 0, screenshotOnFailure: true, postconditionTimeoutMs: 20,
  });
  return executor.runScenario(kichBan([
    { keyword: 'When', line: 10, text: 'I click "Nút"', intent: { kind: 'tap', element: 'man.nut' } },
    { keyword: 'Then', line: 11, text: '"Xong" is visible', intent: { kind: 'assertVisible', element: 'man.xong' } },
  ]));
}

describe('ảnh lúc bước hỏng', () => {
  it('bấm hỏng chỉ để lại MỘT ảnh, không phải hai', async () => {
    const daChup: string[] = [];
    const ketQua = await chay(daChup);
    assert.equal(ketQua.runs[0]?.steps[0]?.status, 'failed', 'bước phải hỏng thì mới có ảnh');
    assert.equal(
      daChup.length, 1,
      `chụp ${daChup.length} ảnh cho một khoảnh khắc: ${daChup.join(', ')}`,
    );
  });

  /**
   * Ảnh dùng lại phải thật sự đi vào report. Nếu chỉ bỏ lần chụp thứ hai mà
   * không gắn ảnh đã có vào StepResult thì ca fail mất ảnh hoàn toàn — đổi một
   * phiền toái lấy một mất mát.
   */
  it('ảnh đó được gắn vào bước hỏng', async () => {
    const daChup: string[] = [];
    const ketQua = await chay(daChup);
    const shot = ketQua.runs[0]?.steps[0]?.screenshot;
    assert.ok(shot, 'bước hỏng phải mang theo ảnh');
    assert.match(shot, /^tap-declined-/, `ảnh phải là ảnh nhánh thoát đã chụp, đang là "${shot}"`);
  });
});
