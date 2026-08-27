import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  controlHintsFromObservation,
  mergeAccessibilityObservations,
  parsePlaywrightMcpSnapshot,
} from '../PlaywrightMcpObserver.js';

describe('PlaywrightMcpObserver', () => {
  it('parses role, accessible name, text and placeholder', () => {
    const observed = parsePlaywrightMcpSnapshot(`
### Snapshot
\`\`\`yaml
- main [ref=e2]:
  - heading "Tài sản trái phiếu" [level=1] [ref=e3]
  - generic [ref=e4]:
    - text: Mã trái phiếu
    - textbox "Mã trái phiếu" [ref=e5]:
      - /placeholder: Nhập mã
  - button "Xem tài sản" [ref=e6]: Xem
\`\`\`
`);

    assert.deepEqual(observed, [
      { role: 'heading', name: 'Tài sản trái phiếu', interactive: false, index: 0, container: false },
      { text: 'Mã trái phiếu', interactive: false, index: 1, container: false },
      { role: 'textbox', name: 'Mã trái phiếu', placeholder: 'Nhập mã', interactive: true, index: 2, container: false },
      { role: 'button', name: 'Xem tài sản', text: 'Xem', interactive: true, index: 3, container: false },
    ]);
  });

  it('enriches matching DOM observations without duplicating them', () => {
    const result = mergeAccessibilityObservations(
      [{ role: 'button', text: 'Xem', name: 'Xem tài sản', css: 'button.asset', interactive: true, index: 0, container: false }],
      [{ role: 'button', name: 'Xem tài sản', text: 'Xem', interactive: true, index: 0, container: false }],
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]!.css, 'button.asset');
    assert.equal(result[0]!.name, 'Xem tài sản');
  });

  it('contributes date-picker semantics from the MCP accessibility snapshot', () => {
    const observed = parsePlaywrightMcpSnapshot(`
- textbox [ref=e1]: 01/01/2026
- button "Open calendar" [ref=e2]
`);
    assert.deepEqual(controlHintsFromObservation(observed, 'date'), [
      'playwright-mcp: textbox exposed',
      'playwright-mcp: calendar button "Open calendar"',
    ]);
  });
});

describe('role preference when the two observers disagree', () => {
  const dom = (over: Record<string, unknown> = {}) => ({
    role: 'input', placeholder: 'Mã cổ phiếu', css: 'input.flex-1',
    interactive: true, index: 0, container: false, ...over,
  });

  it('lets the accessibility tree correct a tag-name role', () => {
    // The DOM scan reports the tag; the snapshot reports what the control is to
    // a user. Filling only the gap kept the weaker answer, because the DOM path
    // had always already supplied one — and `combobox` is what makes an input
    // step recognise the field at all.
    const [merged] = mergeAccessibilityObservations(
      [dom() as never],
      [{ role: 'combobox', name: 'Mã cổ phiếu', interactive: true, index: 0, container: false } as never],
    );
    assert.equal(merged!.role, 'combobox');
    assert.equal(merged!.name, 'Mã cổ phiếu', 'tên vẫn phải được gắn vào');
    assert.equal(merged!.css, 'input.flex-1', 'selector của DOM phải giữ nguyên');
  });

  it('does not let a generic wrapper role overwrite a real one', () => {
    const [merged] = mergeAccessibilityObservations(
      [dom({ role: 'combobox' }) as never],
      [{ role: 'generic', placeholder: 'Mã cổ phiếu', interactive: false, index: 0, container: false } as never],
    );
    assert.equal(merged!.role, 'combobox', 'generic không được ghi đè vai trò thật');
  });

  it('still fills a role the DOM scan never determined', () => {
    const [merged] = mergeAccessibilityObservations(
      [dom({ role: undefined }) as never],
      [{ role: 'generic', placeholder: 'Mã cổ phiếu', interactive: false, index: 0, container: false } as never],
    );
    assert.equal(merged!.role, 'generic', 'chỗ trống thì vẫn lấp như cũ');
  });
});
