import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isScopedFeatureSearchResult } from '../driver.js';

describe('fast exact feature-result click', () => {
  it('recognises only the explicitly scoped feature-search result', () => {
    assert.equal(isScopedFeatureSearchResult({
      strategy: 'label', value: 'Bảng giá cổ phiếu', weight: 1,
      origin: 'authored', runtimeScope: '.searched-feature-block',
    }), true);
    assert.equal(isScopedFeatureSearchResult({
      strategy: 'label', value: 'Bảng giá cổ phiếu', weight: 1,
      origin: 'authored',
    }), false);
  });

  for (const file of ['src/drivers/web.ts', 'src/drivers/WebViewCdpDriver.ts']) {
    it(`${file} skips the redundant pre-click overlay scan`, () => {
      const source = readFileSync(file, 'utf8');
      assert.match(source, /if \(!isScopedFeatureSearchResult\(handle\.candidate\)\)/);
    });
  }

  it('does not wait for global idleness before checking the destination', () => {
    for (const file of ['src/runtime/executor.ts', 'src/pom/BasePage.ts']) {
      const source = readFileSync(file, 'utf8');
      const start = source.indexOf('async openFeatureFromSearch(');
      const end = source.indexOf('returnToHomeForSearch(', start);
      const body = source.slice(start, end);
      assert.doesNotMatch(body, /driver\.isIdle\(/);
    }
  });
});
