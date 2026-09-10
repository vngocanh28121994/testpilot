/**
 * "Nút đăng nhập" và "Đăng nhập" là cùng một thứ.
 *
 * Chữ đầu của nhãn nói đây là LOẠI điều khiển gì, không phải nội dung nó mang.
 * Không bỏ nó ra thì phép so chỉ đạt mức "một phần" — 14 điểm thay vì 20 — cho
 * một element khớp hoàn hảo.
 *
 * Đo trên máy thật ngày 2026-09-10, màn đăng nhập của TCInvest, 51 phần tử DOM:
 *
 *   nút <button> mang chữ "Đăng nhập"  →  19 điểm  (ngưỡng 40)
 *     = 14 (text khớp một phần) + 15 (vai trò) + 15 (màn hình) − 25 (trùng chữ)
 *
 * Hai mươi lăm điểm trừ kia đến từ chính cái <span> nằm BÊN TRONG nút, mang
 * đúng chữ đó — tức là nút bị phạt vì nó có nhãn.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfidenceScorer } from '../ConfidenceScorer.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { ObservedElement } from '../UiObservation.js';

const intent = {
  id: 'login.submitButton',
  label: 'Nút đăng nhập',
  action: 'tap',
} as unknown as ElementIntent;

const el = (over: Partial<ObservedElement>): ObservedElement => ({
  id: 'x', role: 'button', interactive: true, visible: true, ...over,
} as ObservedElement);

describe('nhãn có danh từ chỉ loại điều khiển', () => {
  it('nút mang đúng chữ được tính là khớp CHÍNH XÁC', () => {
    const scorer = new ScorerUnderTest();
    const nut = el({ id: 'nut', text: 'Đăng nhập' });
    const s = scorer.score(intent, nut, { allCandidates: [nut], screen: 'login' });
    assert.ok(
      s.reasons.some((r) => /text exact match/.test(r)),
      `phải là khớp chính xác, nhận được: ${s.reasons.join('; ')}`,
    );
  });

  /**
   * Trong DOM, một cái nút thường bọc <span> chứa đúng chữ đó. Phạt cả hai là
   * phạt chính cái nút. Ambiguity chỉ có thật khi HAI thứ cùng bấm được mang
   * cùng một chữ.
   */
  it('không phạt nút vì cái span bên trong nó trùng chữ', () => {
    const scorer = new ScorerUnderTest();
    const nut = el({ id: 'nut', text: 'Đăng nhập', interactive: true });
    const span = el({ id: 'span', role: 'span', text: 'Đăng nhập', interactive: false });
    const s = scorer.score(intent, nut, { allCandidates: [nut, span], screen: 'login' });
    assert.ok(
      !s.penalties.some((p) => /duplicate/.test(p)),
      `không được phạt trùng, nhận được: ${s.penalties.join('; ')}`,
    );
  });

  it('vẫn phạt khi có hai nút cùng chữ — lúc đó mập mờ là thật', () => {
    const scorer = new ScorerUnderTest();
    const a = el({ id: 'a', text: 'Đăng nhập', interactive: true });
    const b = el({ id: 'b', text: 'Đăng nhập', interactive: true });
    const s = scorer.score(intent, a, { allCandidates: [a, b], screen: 'login' });
    assert.ok(
      s.penalties.some((p) => /duplicate/.test(p)),
      'hai nút cùng chữ thì phải bị phạt',
    );
  });
});

class ScorerUnderTest extends ConfidenceScorer {}
