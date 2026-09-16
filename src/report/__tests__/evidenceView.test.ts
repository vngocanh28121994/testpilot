import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildShotEvidence, sortEvidenceTimeline } from '../evidenceView.js';

describe('shared evidence view model', () => {
  it('phân loại ảnh và nối lại tên chapter có dấu', () => {
    const evidence = buildShotEvidence([
      { name: 'chuyen-tien-thanh-cong-a1-l27-pass', url: '/pass.png', onFailure: false },
      { name: 'chuyen-tien-bi-loi-a1-l9-fail', url: '/fail.png', onFailure: true },
      {
        name: 'chuyen-tien-known-a1-l42-fail', url: '/known.png', onFailure: true,
        knownIssue: 'Chưa hỗ trợ',
      },
      { name: 'anh-tu-dat', url: '/info.png', onFailure: false },
    ], [
      { name: 'Chuyển tiền thành công', status: 'passed', at: 12 },
      { name: 'Chuyển tiền bị lỗi', status: 'failed', at: 28 },
    ]);

    assert.deepEqual(evidence.map(({ kind, label, at }) => ({ kind, scenario: label.scenario, at })), [
      { kind: 'passed', scenario: 'Chuyển tiền thành công', at: 12 },
      { kind: 'failed', scenario: 'Chuyển tiền bị lỗi', at: 28 },
      { kind: 'known', scenario: 'chuyen tien known', at: Number.POSITIVE_INFINITY },
      { kind: 'other', scenario: '', at: Number.POSITIVE_INFINITY },
    ]);
  });

  it('xếp theo timeline và giữ nguyên thứ tự khi thiếu hoặc trùng thời gian', () => {
    const values = [
      { name: 'không có giờ', at: Number.NaN },
      { name: 'sau', at: 20 },
      { name: 'trước 1', at: 10 },
      { name: 'trước 2', at: 10 },
    ];
    assert.deepEqual(
      sortEvidenceTimeline(values, (value) => value.at).map((value) => value.name),
      ['trước 1', 'trước 2', 'sau', 'không có giờ'],
    );
  });
});
