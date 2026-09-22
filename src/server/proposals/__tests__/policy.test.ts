/**
 * Cái gì nhận thẳng, cái gì chờ người duyệt — và vì sao ranh giới nằm ở đó.
 *
 * Bài đáng giá nhất ở đây là hai ca ĐỐI NHAU. Một element mới phải đi thẳng
 * vào registry: bắt người duyệt bấm đồng ý cho hai trăm element mới mỗi tuần
 * là cách chắc chắn nhất khiến họ bấm mà không đọc. Một locator ĐỔI thì phải
 * chờ: nó đè lên thứ người khác đã đặt, và "runner học được" không phải là
 * bằng chứng — nó là một lượt chạy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { split, AUTO_ACCEPT_WINS } from '../policy.js';
import type { ElementRegistry } from '../../../core/types.js';

function element(id: string, value: string, wins?: number): ElementRegistry['elements'][string] {
  return {
    id,
    label: id,
    screen: 'login',
    candidates: {
      android: [{ strategy: 'predicate', value, weight: 1, origin: 'healed' }],
    },
    ...(wins === undefined
      ? {}
      : { health: { resolutions: wins, heals: 1, winners: { [value]: wins } } }),
  };
}

function registry(...elements: Array<ReturnType<typeof element>>): ElementRegistry {
  return {
    version: 1,
    screens: {},
    elements: Object.fromEntries(elements.map((item) => [item.id, item])),
  };
}

describe('chính sách nhận tự động', () => {
  it('element mới thì nhận thẳng, không ai phải bấm gì', () => {
    const result = split(registry(element('a', 'name == "a"')), registry());
    assert.deepEqual(Object.keys(result.autoMerge.elements), ['a']);
    assert.equal(result.needsReview, undefined);
  });

  it('locator đổi mà chưa thắng đủ lần thì chờ duyệt', () => {
    const current = registry(element('a', 'name == "cũ"'));
    const learned = registry(element('a', 'name == "mới"', AUTO_ACCEPT_WINS - 1));

    const result = split(learned, current);
    assert.deepEqual(Object.keys(result.autoMerge.elements), []);
    assert.deepEqual(Object.keys(result.needsReview!.elements), ['a']);
    assert.match(result.reasons.a!, /chưa thắng đủ/);
  });

  it('locator đổi mà đã thắng đủ lần thì nhận thẳng', () => {
    const current = registry(element('a', 'name == "cũ"'));
    const learned = registry(element('a', 'name == "mới"', AUTO_ACCEPT_WINS));

    const result = split(learned, current);
    assert.deepEqual(Object.keys(result.autoMerge.elements), ['a']);
    assert.equal(result.needsReview, undefined);
  });

  it('không đổi gì thì vẫn nhận, để số lần thắng được cộng dồn', () => {
    // Đây là thứ nuôi chính cái ngưỡng ở trên: nếu một lượt chạy dùng đúng
    // locator đang có mà ta bỏ qua nó, `winners` không bao giờ lớn lên và
    // không locator nào đủ tin để tự nhận.
    const same = element('a', 'name == "a"', 1);
    const result = split(registry(same), registry(same));
    assert.deepEqual(Object.keys(result.autoMerge.elements), ['a']);
    assert.equal(result.needsReview, undefined);
  });

  it('nền tảng mới trên element cũ là thêm, không phải đè', () => {
    const current = registry(element('a', 'name == "a"'));
    const learned: ElementRegistry = {
      version: 1, screens: {},
      elements: {
        a: {
          id: 'a', label: 'a', screen: 'login',
          candidates: { ios: [{ strategy: 'predicate', value: 'label == "a"', weight: 1, origin: 'healed' }] },
        },
      },
    };
    const result = split(learned, current);
    assert.deepEqual(Object.keys(result.autoMerge.elements), ['a']);
  });

  it('màn hình đi theo phần nhận thẳng', () => {
    const learned: ElementRegistry = {
      version: 1,
      screens: { login: { id: 'login', title: 'Đăng nhập' } },
      elements: {},
    };
    const result = split(learned, registry());
    assert.deepEqual(Object.keys(result.autoMerge.screens), ['login']);
  });
});
