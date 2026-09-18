/**
 * Tầng thị giác runtime phải có công tắc riêng, và mặc định là TẮT.
 *
 * Nó là tầng đắt nhất trong ba tầng discovery và là tầng duy nhất gửi ảnh màn
 * hình ra ngoài. Gộp nó vào chung `discovery.ai.enabled` nghĩa là muốn tiết
 * kiệm tiền thì phải tắt luôn cả tầng semantic — thứ rẻ hơn nhiều và gánh phần
 * lớn công việc.
 *
 * Tắt từ 2026-09-18 để dành ngân sách model cho việc sinh testcase.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = readFileSync('src/config.ts', 'utf8');
const run = readFileSync('src/cli/run.ts', 'utf8');

describe('công tắc tầng thị giác', () => {
  it('mặc định tắt trong schema config', () => {
    assert.match(config, /vision: z\.boolean\(\)\.default\(false\)/);
  });

  /** Tắt vision KHÔNG được kéo theo semantic: hai tầng, hai mức chi phí. */
  it('tầng semantic không phụ thuộc vào công tắc vision', () => {
    const semantic = run.slice(run.indexOf('const semanticDiscovery'), run.indexOf('const visionDiscovery'));
    assert.ok(!semantic.includes('ai.vision'), 'semantic không được đọc công tắc vision');
    assert.match(semantic, /cfg\.discovery\.ai\.enabled/);
  });

  it('vision chỉ được dựng khi bật cả hai cờ', () => {
    const vision = run.slice(run.indexOf('const visionDiscovery'), run.indexOf('const resolver'));
    assert.match(vision, /cfg\.discovery\.ai\.enabled\s*&&\s*cfg\.discovery\.ai\.vision/);
  });

  /** Một tầng bị tắt mà im lặng là thứ khiến người ta đọc log đoán mò. */
  it('nói ra khi tầng vision đang tắt', () => {
    assert.match(run, /discovery:vision\] đang TẮT/);
  });
});
