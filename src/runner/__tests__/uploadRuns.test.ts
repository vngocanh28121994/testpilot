/**
 * Đẩy bằng chứng lên kho, và KHÔNG làm hỏng job khi việc ấy hỏng.
 *
 * Đó là tính chất đáng giá nhất ở đây. Artifact là bằng chứng, không phải kết
 * quả: suite đã chạy xong, verdict đã có. Một lượt chạy báo "thất bại" chỉ vì
 * mạng rớt lúc tải ảnh lên là nói dối về thứ đắt hơn nhiều — và người đọc sẽ
 * đi chạy lại một bộ test vốn đã pass.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { uploadRuns, type UploadDeps } from '../artifacts.js';

let dir: string;
let runDir: string;

async function seed(files: Record<string, string>): Promise<void> {
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(runDir, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf8');
  }
}

type Deps = UploadDeps & { lines: string[]; put: NonNullable<UploadDeps['put']> };

function deps(over: Partial<UploadDeps> = {}): Deps {
  const lines: string[] = [];
  const base: Deps = {
    lines,
    put: async () => {},
    log: (line: string) => { lines.push(line); },
    sign: async (_jobId: string, files: string[]) => files.map((file) => ({
      file, key: `org-1/job-1/${file}`, url: `https://s3/${file}`, contentType: 'text/plain',
    })),
    done: async () => {},
  };
  return { ...base, ...over };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tp-upload-'));
  runDir = path.join(dir, '2026-09-23T10-00-00');
  await fs.mkdir(runDir, { recursive: true });
});

describe('đẩy thư mục lượt chạy', () => {
  it('đi hết cây thư mục, và khoá mang tên lượt chạy chứ không mang đường dẫn máy', async () => {
    await seed({ 'report.html': 'x', 'shots/step-1.png': 'y' });
    const asked: string[][] = [];
    const d = deps({ sign: async (_id, files) => {
      asked.push(files);
      return files.map((file) => ({ file, key: `org-1/job-1/${file}`, url: 'https://s3/x', contentType: 'text/plain' }));
    } });

    const summary = await uploadRuns([runDir], 'job-1', d);

    assert.equal(summary.uploaded, 2);
    // `/Users/an/projects/...` vừa vô nghĩa với người đọc vừa nói ra tên
    // người dùng trên máy của một người.
    assert.deepEqual(asked[0]!.sort(), [
      '2026-09-23T10-00-00/report.html',
      '2026-09-23T10-00-00/shots/step-1.png',
    ]);
  });

  it('KHÔNG đẩy learned.json — nó đi theo đường đề xuất registry', async () => {
    await seed({ 'report.html': 'x', 'learned.json': '{}' });
    const d = deps();
    await uploadRuns([runDir], 'job-1', d);
    // Hai bản của cùng một sự thật, và bản trong kho không bao giờ được ai đọc.
    const signed = (await d.sign('job-1', ['x'])).length;
    assert.equal(signed, 1);
    const summary = await uploadRuns([runDir], 'job-1', deps());
    assert.equal(summary.uploaded, 1);
  });

  it('một file hỏng không kéo theo những file còn lại', async () => {
    await seed({ 'a.txt': '1', 'b.txt': '2', 'c.txt': '3' });
    const d = deps({
      put: async (url) => { if (url.includes('b.txt')) throw new Error('mạng rớt'); },
      sign: async (_id, files) => files.map((file) => ({
        file, key: `org-1/job-1/${file}`, url: `https://s3/${file}`, contentType: 'text/plain',
      })),
    });

    const summary = await uploadRuns([runDir], 'job-1', d);
    assert.equal(summary.uploaded, 2);
    assert.equal(summary.failed, 1);
    assert.ok(d.lines.some((line) => line.includes('b.txt')), 'phải nói ra file nào hỏng');
  });

  it('server chưa có kho thì chỉ là một dòng log, không phải một ngoại lệ', async () => {
    await seed({ 'report.html': 'x' });
    const d = deps({ sign: async () => { throw new Error('501 chưa cấu hình kho artifact'); } });

    // KHÔNG ném: lượt chạy đã xong, và đây là lý do cả file này tồn tại.
    const summary = await uploadRuns([runDir], 'job-1', d);
    assert.equal(summary.uploaded, 0);
    assert.equal(summary.failed, 1);
    assert.ok(d.lines.some((line) => line.includes('không cấp được link')));
  });

  it('chỉ báo sổ những file ĐÃ ghi được', async () => {
    await seed({ 'a.txt': '1', 'b.txt': '2' });
    const reported: Array<{ key: string }> = [];
    const d = deps({
      put: async (url) => { if (url.includes('b.txt')) throw new Error('hỏng'); },
      sign: async (_id, files) => files.map((file) => ({
        file, key: `org-1/job-1/${file}`, url: `https://s3/${file}`, contentType: 'text/plain',
      })),
      done: async (_id, files) => { reported.push(...files); },
    });

    await uploadRuns([runDir], 'job-1', d);
    // Một dòng trong sổ nói "có file này" trong khi kho không có gì thì màn
    // hình sẽ vẽ ra một liên kết hỏng.
    assert.deepEqual(reported.map((file) => file.key), ['org-1/job-1/2026-09-23T10-00-00/a.txt']);
  });

  it('thư mục không đọc được thì bỏ qua, không dừng cả lượt', async () => {
    const summary = await uploadRuns([path.join(dir, 'khong-co')], 'job-1', deps());
    assert.equal(summary.uploaded, 0);
  });
});
