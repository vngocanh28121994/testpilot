/**
 * Opening a feature means clicking the search result, not the query text.
 *
 * The step waited on `home.searchFirstResult` — a locator matching exactly one
 * node — and then clicked something else: an element found by the query text.
 * Searching "Chuyển tiền" leaves that phrase in seven visible places on this
 * app (the header toolbox, the home grid behind the dialog, the screen title),
 * and the text lookup returned all seven. It clicked whichever came first in
 * the DOM, which for a long time happened to be the right one and then was not:
 *
 *     bấm theo chữ    → 7 khớp | đầu tiên: header-toolbox   trong hộp thoại: KHÔNG
 *     bấm kết quả đầu → 1 khớp | đầu tiên: .title           trong hộp thoại: CÓ
 *
 * Nothing about the app had broken. The step had simply been relying on DOM
 * order among seven candidates.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Both implementations, because there are two and only one was fixed at first.
 *
 * `BasePage` serves generated POM tests; `Executor` serves the Gherkin runner.
 * They implement the same step separately, so a fix to one leaves the other
 * broken — and the one that matters for a suite run is the Executor.
 */
const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['BasePage', 'src/pom/BasePage.ts'],
  ['Executor', 'src/runtime/executor.ts'],
];

function body(file: string): string {
  const source = readFileSync(file, 'utf8');
  // Anchored on the definition. `openFeatureFromSearch` also appears earlier in
  // executor.ts as an intent name, and slicing from there reads a different
  // method entirely.
  const at = /(?:private )?async openFeatureFromSearch\(/.exec(source)?.index ?? -1;
  assert.ok(at > 0, `${file} has no openFeatureFromSearch definition`);
  return source.slice(at, at + 2400);
}

describe('opening a feature from search', () => {
  for (const [name, file] of SOURCES) {
    it(`${name} clicks the same locator it waited on`, () => {
      const steps = body(file);
      assert.match(steps, /home\.searchFirstResult/);
      const waited = steps.indexOf('home.searchFirstResult');
      const clicked = steps.indexOf('home.searchFirstResult', waited + 1);
      assert.ok(clicked > waited, 'waits on the result but never clicks it');
    });

    it(`${name} does not pick the target by the query text`, () => {
      // `home.dynamicText` resolves `{{text}}` against the whole page, which is
      // how a header outside the dialog won.
      assert.doesNotMatch(body(file), /home\.dynamicText/);
    });

    it(`${name} still opens the search box and types the query first`, () => {
      const steps = body(file);
      const box = steps.indexOf('home.searchBox');
      const input = steps.indexOf('home.searchInput');
      const result = steps.indexOf('home.searchFirstResult');
      assert.ok(box >= 0 && input > box, 'the search box must be opened before typing');
      assert.ok(result > input, 'the result must be waited for after typing');
    });
  }
});
