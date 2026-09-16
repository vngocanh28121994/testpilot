import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { reportShotContexts } from '../reportEvidence.js';

describe('report screenshot context', () => {
  it('nối tap-declined với đúng testcase, bước và lỗi từ report.json', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'testpilot-shot-context-'));
    await writeFile(path.join(dir, 'report.json'), JSON.stringify({
      report: {
        results: [{
          scenario: { name: 'Chọn đúng hai tiểu khoản' },
          runs: [{ attempt: 1, steps: [{
            status: 'failed',
            step: { keyword: 'And', text: 'I open feature from search', line: 7 },
            screenshot: `${dir}/artifacts/tap-declined-123.png`,
            error: { message: 'locator.click: Timeout 5000ms exceeded.\nCall log:' },
          }] }],
        }],
      },
    }));

    const context = (await reportShotContexts(dir)).get('tap-declined-123.png');
    assert.deepEqual(context, {
      scenario: 'Chọn đúng hai tiểu khoản',
      detail: 'lúc fail · dòng 7 · And I open feature from search',
      error: 'locator.click: Timeout 5000ms exceeded.',
    });
  });

  it('giữ ảnh của known issue ngoài nhóm fail bằng id và đúng content hash', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'testpilot-known-shot-'));
    await writeFile(path.join(dir, 'report.json'), JSON.stringify({
      report: {
        results: [{
          scenario: {
            id: 'dropdown-nguon', name: 'Tiểu khoản đích không có ở nguồn', contentHash: 'hash-1',
          },
          runs: [{ attempt: 1, steps: [{
            status: 'failed',
            step: { keyword: 'Then', text: 'TK Ký Quỹ is absent', line: 42 },
            screenshot: `${dir}/artifacts/dropdown-nguon-a1-l42-fail.png`,
            error: { message: 'TK Ký Quỹ vẫn nằm trong danh sách' },
          }] }],
        }],
      },
    }));
    const known = {
      active: (id: string, hash: string) => id === 'dropdown-nguon' && hash === 'hash-1'
        ? { note: 'Sản phẩm chưa hỗ trợ chiều ngược lại' }
        : undefined,
    };

    const context = (await reportShotContexts(dir, known)).get('dropdown-nguon-a1-l42-fail.png');
    assert.equal(context?.knownIssue, 'Sản phẩm chưa hỗ trợ chiều ngược lại');
    assert.match(context?.detail ?? '', /^known issue · dòng 42/);
    assert.match(context?.error ?? '', /vẫn nằm trong danh sách/);
  });
});
