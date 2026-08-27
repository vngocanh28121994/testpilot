/**
 * An assertion that checks nothing must not pass.
 *
 * "This value is not among the choices" is trivially true of an empty list, so
 * a reader that simply looked at a closed dropdown would return no options and
 * the assertion would go green having verified nothing — the worst kind of
 * green, because it looks like coverage. The driver therefore opens the list as
 * part of the contract, and reports `undefined` when it cannot answer at all;
 * `undefined` has to fail rather than read as "no options".
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Registry } from '../../core/registry.js';
import type { UiDriver, UiHandle } from '../../drivers/driver.js';
import { Resolver } from '../resolver.js';
import { Executor } from '../executor.js';

const handle: UiHandle = {
  candidate: { strategy: 'label', value: 'Chọn TK nhận tiền', weight: 1, origin: 'authored' },
  isVisible: async () => true,
  text: async () => 'Chọn TK nhận tiền',
};

function driverWith(listOptions?: () => Promise<string[] | undefined>): UiDriver {
  return {
    platform: 'web',
    device: 'test',
    start: async () => {}, stop: async () => {}, launch: async () => {},
    find: async () => handle,
    tap: async () => {}, longPress: async () => {}, input: async () => {},
    clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
    swipe: async () => {}, scroll: async () => {}, back: async () => {},
    screenshot: async () => '', isIdle: async () => true,
    ...(listOptions ? { listOptions } : {}),
  } as unknown as UiDriver;
}

async function run(
  driver: UiDriver,
  expect: 'present' | 'absent',
  option: string,
): Promise<string | undefined> {
  const registry = await Registry.load('/dev/null/nonexistent-registry.json');
  registry.upsertElement({
    id: 'transfer.destination',
    label: 'Chọn TK nhận tiền',
    screen: 'transfer',
    candidates: { web: [handle.candidate] },
  });
  const resolver = new Resolver(driver, registry, {
    timeoutMs: 200, pollMs: 50, requireVisible: false, verifyHealedMatch: false,
  });
  const executor = new Executor(driver, resolver);
  const [result] = await executor.runStepsWithoutTeardown([{
    line: 1,
    text: `"${option}" is ${expect === 'absent' ? 'not ' : ''}an option in "Chọn TK nhận tiền"`,
    intent: { kind: 'assertOption', element: 'transfer.destination', option, expect },
  } as never]);
  return result?.status === 'passed' ? undefined : String(result?.error?.message ?? 'lỗi không rõ');
}

describe('asserting a dropdown choice', () => {
  it('passes when an absent value really is absent', async () => {
    const driver = driverWith(async () => ['TK Ký Quỹ', 'TK iPower']);
    assert.equal(await run(driver, 'absent', 'TK Thường'), undefined);
  });

  it('fails when the value is in the list, and names what was offered', async () => {
    const driver = driverWith(async () => ['TK Thường', 'TK Ký Quỹ']);
    const err = await run(driver, 'absent', 'TK Thường');
    assert.match(String(err), /vẫn nằm trong danh sách/);
    assert.match(String(err), /TK Ký Quỹ/);
  });

  it('fails an "is an option" claim the list does not support', async () => {
    const driver = driverWith(async () => ['TK Ký Quỹ']);
    assert.match(String(await run(driver, 'present', 'TK Thường')), /không có trong danh sách/);
  });

  it('refuses when the driver cannot answer, rather than passing on silence', async () => {
    // A native driver outside a WebView returns undefined. Reading that as an
    // empty list would make every `absent` assertion pass on that platform.
    const driver = driverWith(async () => undefined);
    assert.match(String(await run(driver, 'absent', 'TK Thường')), /Không mở\/đọc được/);
  });

  it('refuses when the driver has no such capability at all', async () => {
    const driver = driverWith(undefined);
    assert.match(String(await run(driver, 'absent', 'TK Thường')), /không đọc được danh sách/);
  });

  it('ignores case and spacing, as the scenario writes what a user reads', async () => {
    const driver = driverWith(async () => ['TK  Ký   Quỹ']);
    assert.equal(await run(driver, 'present', 'tk ký quỹ'), undefined);
  });
});
