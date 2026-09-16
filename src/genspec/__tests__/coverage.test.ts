import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SourceDoc } from '../../ingest/types.js';
import {
  auditFeatureCoverage,
  enforceFeatureCoverage,
  extractCoverageMap,
  tryAuditFeatureCoverage,
  type CoverageRequirement,
} from '../coverage.js';

const doc: SourceDoc = {
  kind: 'confluence',
  ref: 'https://example.test/wiki/add-stock',
  title: 'Thêm mã cổ phiếu',
  text:
    'Người dùng có thể tìm kiếm theo mã hoặc tên doanh nghiệp.\n' +
    'Tự động lọc trùng khi kết quả tìm kiếm từ mã trùng với kết quả tìm được theo tên doanh nghiệp.',
  fetchedAt: '2026-08-24T00:00:00.000Z',
};

describe('testcase coverage gate', () => {
  it('keeps post-review coverage audit failures non-blocking', async () => {
    const requirement: CoverageRequirement = {
      id: 'REQ-001', key: 'req:approved', sourceId: 'SRC-001', priority: 'P1',
      rule: 'Kịch bản đã được duyệt', sourceQuote: 'Kịch bản đã được duyệt',
      expectedResult: 'Workflow tiếp tục chạy', sourceRef: doc.ref,
    };
    const result = await tryAuditFeatureCoverage('Feature: F', [requirement], {
      model: 'deepseek-chat',
      json: async () => { throw new Error('model timeout'); },
    });

    assert.deepEqual(result, { ok: false, error: 'model timeout' });
  });

  it('keeps a rule-like source note as P1 even when the model misclassifies it as INFO', async () => {
    const map = await extractCoverageMap([doc], {
      model: 'deepseek-chat',
      json: async () => JSON.stringify({
        classifications: [
          {
            sourceId: 'SRC-001', priority: 'P1',
            rule: 'Cho phép tìm theo mã hoặc tên doanh nghiệp',
            expectedResult: 'Có kết quả phù hợp',
          },
          {
            sourceId: 'SRC-002', priority: 'INFO',
            rule: 'Lọc trùng kết quả tìm kiếm',
            expectedResult: 'Mỗi mã chỉ xuất hiện một lần',
          },
        ],
      }),
    });

    assert.equal(map.requirements.length, 2);
    const dedupe = map.requirements.find((item) => item.sourceId === 'SRC-002');
    assert.equal(dedupe?.priority, 'P1');
    assert.match(dedupe?.sourceQuote ?? '', /lọc trùng/i);
  });

  it('does not trust a covered claim whose evidence is absent from the feature', async () => {
    const requirement: CoverageRequirement = {
      id: 'REQ-001', key: 'req:dedupe', sourceId: 'SRC-001', priority: 'P1',
      rule: 'Lọc trùng kết quả', sourceQuote: 'Tự động lọc trùng',
      expectedResult: 'AAA chỉ xuất hiện một lần', sourceRef: doc.ref,
    };
    const audit = await auditFeatureCoverage(
      'Feature: Tìm kiếm\n  Scenario: Có kết quả\n    Then "AAA" is visible',
      [requirement],
      {
        model: 'deepseek-chat',
        json: async () => JSON.stringify({
          mappings: [{
            requirementId: 'REQ-001', status: 'covered', scenarios: ['Có kết quả'],
            evidence: ['Then "AAA" xuất hiện đúng một lần'], reason: 'đã cover',
          }],
        }),
      },
    );
    assert.equal(audit.decision, 'repair');
    assert.deepEqual(audit.missingRequirementIds, ['REQ-001']);
  });

  it('backfills a stable requirement key for legacy coverage JSON', async () => {
    const requirement: CoverageRequirement = {
      id: 'REQ-001', sourceId: 'SRC-001', priority: 'P1',
      rule: 'Có kết quả', sourceQuote: 'Kết quả hiển thị',
      expectedResult: 'AAA hiển thị', sourceRef: doc.ref,
    };
    const line = 'Then "AAA" is visible';
    const audit = await auditFeatureCoverage(`Feature: F\n  Scenario: S\n    ${line}`, [requirement], {
      model: 'deepseek-chat',
      json: async () => JSON.stringify({
        mappings: [{
          requirementId: 'REQ-001', status: 'covered', scenarios: ['S'], evidence: [line], reason: 'Đủ',
        }],
      }),
    });
    assert.match(audit.mappings[0]?.requirementKey ?? '', /^req:[a-f0-9]{20}$/);
  });

  it('repairs a missing P1 scenario and audits the repaired feature again', async () => {
    const requirement: CoverageRequirement = {
      id: 'REQ-001', key: 'req:dedupe', sourceId: 'SRC-002', priority: 'P1',
      rule: 'Lọc trùng kết quả tìm kiếm',
      sourceQuote: 'Tự động lọc trùng khi kết quả tìm kiếm từ mã trùng với tên doanh nghiệp.',
      expectedResult: 'Mỗi mã chỉ xuất hiện một lần', sourceRef: doc.ref,
    };
    let audits = 0;
    const repaired = [
      'Feature: Thêm mã',
      '  Scenario: Lọc trùng kết quả theo mã và tên doanh nghiệp',
      '    Then "Số kết quả AAA" number is equal to "1"',
    ].join('\n');
    const result = await enforceFeatureCoverage(
      [doc],
      'Feature: Thêm mã\n  Scenario: Có kết quả\n    Then "AAA" is visible',
      [],
      { requirements: [requirement], classifiedSources: 2, sourceUnits: 2 },
      {
        model: 'deepseek-chat',
        json: async () => {
          audits += 1;
          return JSON.stringify({
            mappings: [{
              requirementId: 'REQ-001',
              status: audits === 1 ? 'missing' : 'covered',
              scenarios: audits === 1 ? [] : ['Lọc trùng kết quả theo mã và tên doanh nghiệp'],
              evidence: audits === 1 ? [] : ['Then "Số kết quả AAA" number is equal to "1"'],
              reason: audits === 1 ? 'Chưa có assertion đếm' : 'Có assertion bằng 1',
            }],
          });
        },
        text: async () => repaired,
      },
    );

    assert.equal(result.repaired, true);
    assert.equal(result.audit.decision, 'ready');
    assert.equal(result.feature, repaired);
    assert.equal(audits, 2);
  });

  it('keeps an incomplete repaired draft reviewable instead of failing generation', async () => {
    const requirement: CoverageRequirement = {
      id: 'REQ-001', key: 'req:dedupe', sourceId: 'SRC-002', priority: 'P1',
      rule: 'Lọc trùng kết quả tìm kiếm',
      sourceQuote: 'Tự động lọc trùng khi kết quả tìm kiếm từ mã trùng với tên doanh nghiệp.',
      expectedResult: 'Mỗi mã chỉ xuất hiện một lần', sourceRef: doc.ref,
    };
    const initial = 'Feature: Thêm mã\n  Scenario: Có kết quả\n    Then "AAA" is visible';
    const repaired = [
      'Feature: Thêm mã',
      '  Scenario: Có kết quả tìm kiếm',
      '    Then "AAA" is visible',
    ].join('\n');
    const logs: string[] = [];

    const result = await enforceFeatureCoverage(
      [doc],
      initial,
      [],
      { requirements: [requirement], classifiedSources: 2, sourceUnits: 2 },
      {
        model: 'deepseek-chat',
        json: async () => JSON.stringify({
          mappings: [{
            requirementId: 'REQ-001', status: 'missing', scenarios: [], evidence: [],
            reason: 'Chưa có assertion chứng minh mỗi mã chỉ xuất hiện một lần',
          }],
        }),
        text: async () => repaired,
        log: (line) => logs.push(line),
      },
    );

    assert.equal(result.feature, repaired);
    assert.equal(result.repaired, true);
    assert.equal(result.audit.decision, 'repair');
    assert.deepEqual(result.audit.missingRequirementIds, ['REQ-001']);
    assert.match(logs.at(-1) ?? '', /chuyển sang màn Duyệt/i);
  });

  it('rejects deletion-only evidence for a current-and-other-watchlists rule', async () => {
    const requirement: CoverageRequirement = {
      id: 'REQ-001',
      key: 'req:watchlists-unaffected',
      sourceId: 'SRC-002',
      priority: 'P1',
      rule: 'Xóa mã khỏi danh mục hiện tại không ảnh hưởng danh mục khác',
      sourceQuote: 'Sau khi xoá, mã bị xoá khỏi danh mục hiện tại, không ảnh hưởng tới các danh mục khác',
      expectedResult: 'Mã không còn trong danh mục hiện tại, các danh mục khác không đổi',
      sourceRef: doc.ref,
    };
    const feature = `Feature: Thêm mã
  Scenario: Xóa mã
    Then "Dòng cổ phiếu trong danh mục" does not show "VIC"`;
    const audit = await auditFeatureCoverage(feature, [requirement], {
      model: 'deepseek-chat',
      json: async () => JSON.stringify({
        mappings: [{
          requirementId: 'REQ-001',
          status: 'covered',
          scenarios: ['Xóa mã'],
          evidence: ['Then "Dòng cổ phiếu trong danh mục" does not show "VIC"'],
          reason: 'Đã xóa khỏi danh mục hiện tại.',
        }],
      }),
    });
    assert.equal(audit.decision, 'repair');
    assert.deepEqual(audit.missingRequirementIds, ['REQ-001']);
  });
});
