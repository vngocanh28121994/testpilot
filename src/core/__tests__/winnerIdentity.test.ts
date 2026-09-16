/**
 * Lịch sử thắng phải ghi theo DANH TÍNH của locator.
 *
 * Khoá từng là `${strategy}:${value}`, bỏ mất `name` — trong khi chính kho mã
 * này nói ở chỗ khác rằng "role alone is not identity". Đo trên registry thật:
 * `role=button` với name "Đăng nhập", "CHUYỂN", "QUAY LẠI" và ba tên khác nữa
 * cùng đổ vào một khoá `role:button`, gộp 235 lần thắng của 6 element.
 *
 * Không chỉ bẩn báo cáo: cổng chặn bấm mơ hồ cho một locator đi qua khi nó
 * từng thắng, nên một `role=button` chưa bao giờ thắng cho element này vẫn
 * trông như đã thắng hàng trăm lần.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { provenWins, winnerKey } from '../registry.js';
import type { ElementDef, LocatorCandidate } from '../types.js';

const role = (name: string): LocatorCandidate =>
  ({ strategy: 'role', value: 'button', name, weight: 0.9, origin: 'authored' });

describe('danh tính locator trong lịch sử thắng', () => {
  it('role có name khác nhau là những locator khác nhau', () => {
    assert.notEqual(winnerKey(role('Đăng nhập')), winnerKey(role('QUAY LẠI')));
  });

  it('element chỉ được tính là đã chứng minh với đúng locator của nó', () => {
    const element = {
      id: 'transferConfirm.backButton',
      label: 'Nút QUAY LẠI',
      candidates: {},
      screen: 'x',
      health: { resolutions: 22, heals: 0, winners: { [winnerKey(role('QUAY LẠI'))]: 22 } },
    } as ElementDef;
    assert.equal(provenWins(element, role('QUAY LẠI')), 22);
    assert.equal(provenWins(element, role('Đăng nhập')), 0);
  });

  /**
   * Dữ liệu cũ ghi bằng khoá không có `name`. Đọc lại được, nhưng CHỈ cho ứng
   * viên không có `name` — nếu không thì việc đọc tương thích lại đúng bằng
   * cái nhầm vừa sửa.
   */
  it('đọc được khoá cũ, nhưng không dùng nó để hồi sinh chỗ nhầm', () => {
    const legacy = {
      id: 'login.submitButton',
      label: 'Nút đăng nhập',
      candidates: {},
      screen: 'x',
      health: { resolutions: 50, heals: 0, winners: { 'role:button': 50, 'css:#login': 7 } },
    } as ElementDef;
    assert.equal(
      provenWins(legacy, { strategy: 'css', value: '#login', weight: 0.9, origin: 'authored' }),
      7,
    );
    assert.equal(provenWins(legacy, role('Đăng nhập')), 0);
  });
});
