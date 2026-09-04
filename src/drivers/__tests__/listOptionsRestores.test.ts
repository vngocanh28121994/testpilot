/**
 * Reading a dropdown must leave the screen as it found it.
 *
 * `listOptions` opens the panel on purpose: a closed dropdown reads as zero
 * choices, and "this value is not among the choices" would then pass having
 * checked nothing. But it opened and never closed, so an *assertion* mutated
 * the screen — and Material's backdrop then blocked everything after it:
 *
 *     38| Then "TK Thường" is an option in "Chuyển từ"        ← opened the panel
 *     39| When I select "TK Ký Quỹ" from "Chọn TK nhận tiền"  ← unreachable
 *
 *     expanded=true   label=Chuyển từ
 *     cdk-overlay-backdrop: 1
 *
 * The next line could not be reached, in a scenario whose whole point was
 * selecting from both dropdowns.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const DRIVERS: ReadonlyArray<readonly [string, string]> = [
  ['the WebView driver', 'src/drivers/WebViewCdpDriver.ts'],
  ['the Playwright driver', 'src/drivers/web.ts'],
];

function listOptionsBody(file: string): string {
  const source = readFileSync(file, 'utf8');
  const at = source.indexOf('async listOptions(');
  assert.ok(at > 0, `${file} has no listOptions`);
  return source.slice(at, at + 2600);
}

describe('reading a dropdown', () => {
  for (const [name, file] of DRIVERS) {
    it(`${name} remembers whether it was the one that opened the panel`, () => {
      // A panel the scenario opened itself must be left open; only what this
      // call opened may be closed by it.
      assert.match(listOptionsBody(file), /openedHere/);
    });

    it(`${name} closes the panel on every exit`, () => {
      const body = listOptionsBody(file);
      const closes = body.match(/if \(openedHere\) await this\.closeOpenPanel\(/g) ?? [];
      // Two exits: the stable-list return, and the fallthrough after the
      // deadline. A restore on only one of them leaves the other leaking.
      assert.equal(closes.length, 2, 'an exit path leaves the panel open');
    });

    it(`${name} dismisses without choosing anything`, () => {
      const source = readFileSync(file, 'utf8');
      const at = source.indexOf('private async closeOpenPanel(');
      assert.ok(at > 0, `${file} has no closeOpenPanel`);
      const body = source.slice(at, at + 900);
      // Escape selects nothing. Clicking the backdrop is the fallback, and only
      // the fallback, because a click lands somewhere.
      assert.match(body, /keyboard\.press\('Escape'\)/);
      const esc = body.indexOf("keyboard.press('Escape')");
      const backdrop = body.indexOf('cdk-overlay-backdrop');
      assert.ok(esc < backdrop, 'the backdrop click must be the fallback, not the first move');
    });
  }
});
