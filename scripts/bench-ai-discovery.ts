/**
 * How much of the deterministic pipeline's blind spot the AI tier recovers.
 *
 * Replays captured DOM snapshots — real screens from real failures — rather
 * than driving a device, so the answer is repeatable and costs one model call
 * per case instead of a run on a handset. Every case here is a lookup the
 * deterministic tier could not make; the point is not that the AI is clever but
 * whether it is right often enough, and wrong safely enough, to be worth a call.
 *
 *   npm run bench:ai
 *
 * Needs DEEPSEEK_API_KEY or ANTHROPIC_API_KEY in the environment. The fixtures
 * are run artifacts; a case whose snapshot has been pruned is skipped, not
 * failed, so the benchmark degrades quietly as `runs/` rotates.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { WebViewCdpDriver } from '../src/drivers/WebViewCdpDriver.js';
import { RuntimeRegistry } from '../src/discovery/RuntimeRegistry.js';
import { SemanticElementDiscovery } from '../src/discovery/ai/SemanticElementDiscovery.js';
import { LlmElementProvider } from '../src/discovery/ai/LlmElementProvider.js';
import type { ActionKind, ElementIntent } from '../src/discovery/ElementIntent.js';

interface Case {
  dom: string;
  label: string;
  action: ActionKind;
  /** Matched against the chosen element's JSON. Absent means "must refuse". */
  expect?: RegExp;
  why: string;
}

const CASES: Case[] = [
  {
    dom: 'runs/*web-draft-order/artifacts/*l26-fail.html',
    label: 'KL đặt', action: 'input', expect: /"resourceId":"volume"/,
    why: 'nhãn nằm ở <legend>, ô nhập là <input> bên trong',
  },
  {
    dom: 'runs/*web-draft-order/artifacts/*l26-fail.html',
    label: 'Giá đặt', action: 'input', expect: /"resourceId":"price"/,
    why: 'như trên',
  },
  {
    dom: 'runs/*web-draft-order/artifacts/*l26-fail.html',
    label: 'Ô nhập mã cổ phiếu', action: 'input', expect: /"resourceId":"ticker"/,
    why: 'nhãn mô tả, không trùng chữ nào trên màn hình',
  },
  {
    dom: 'runs/*web-draft-order/artifacts/*l18-fail.html',
    label: 'Lệnh thường', action: 'tap', expect: /Lệnh thường/,
    why: 'ligature <mat-icon> lẫn vào chữ; từng bị chọn nhầm sang ô Tiểu khoản',
  },
];

async function main(): Promise<void> {
  if (!LlmElementProvider.available()) {
    console.error('[bench] chưa có DEEPSEEK_API_KEY hoặc ANTHROPIC_API_KEY.');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  // observe() only needs a page; building the driver through its constructor
  // would demand a device and an adb forward this benchmark has no use for.
  const driver = Object.create(WebViewCdpDriver.prototype) as { page: Page; observe: () => Promise<never> };
  const semantic = new SemanticElementDiscovery(
    new LlmElementProvider(),
    await RuntimeRegistry.load('/tmp/bench-ai-runtime-registry.json'),
  );

  let hit = 0;
  let ran = 0;

  for (const c of CASES) {
    const file = await resolveFixture(c.dom);
    if (!file) {
      console.log(`· ${c.label.padEnd(22)} (bỏ qua — không còn ảnh chụp)`);
      continue;
    }
    ran += 1;
    await page.setContent(await readFile(file, 'utf8'));
    driver.page = page;
    const observation = await (driver.observe() as never as ReturnType<WebViewCdpDriver['observe']>);

    const intent = {
      id: `bench.${ran}`, label: c.label, action: c.action, screen: 'home',
    } as ElementIntent;

    const started = Date.now();
    const result = await semantic.discover(intent, observation, { minConfidence: 60 })
      .catch((err: Error) => ({ method: 'failed' as const, evidence: [err.message] }));
    const ms = Date.now() - started;

    const accepted = result.method !== 'failed';
    const chosen = accepted
      ? observation.elements.find((e) => e.id === (result as { match?: { observedElementId: string } }).match?.observedElementId)
      : undefined;

    const ok = c.expect
      ? accepted && Boolean(chosen) && c.expect.test(JSON.stringify(chosen))
      : !accepted;
    if (ok) hit += 1;

    const shown = chosen
      ? `${chosen.role ?? '?'} ${chosen.resourceId ?? ''} ${(chosen.text ?? chosen.placeholder ?? '').slice(0, 24)}`
      : '(từ chối)';
    console.log(`${ok ? '✓' : '✗'} ${c.label.slice(0, 22).padEnd(22)} ${String(ms).padStart(5)}ms  ${shown}`);
    if (!ok) {
      const last = (result.evidence ?? []).slice(-2).join(' | ');
      console.log(`    ${last.slice(0, 150)}`);
    }
  }

  console.log(`\nTrúng ${hit}/${ran}`);
  await browser.close();
}

/** Newest run artifact matching a `runs/*.../file` shape, or undefined. */
async function resolveFixture(pattern: string): Promise<string | undefined> {
  const { glob } = await import('node:fs/promises') as unknown as {
    glob?: (p: string) => AsyncIterable<string>;
  };
  if (glob) {
    const found: string[] = [];
    for await (const entry of glob(pattern)) found.push(entry);
    return found.sort().pop();
  }
  return existsSync(pattern) ? pattern : undefined;
}

main().catch((err: Error) => {
  console.error(`[bench] ${err.message}`);
  process.exit(1);
});
