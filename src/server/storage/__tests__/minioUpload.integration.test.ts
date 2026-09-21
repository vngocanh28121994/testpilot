/**
 * Đẩy artifact lên MinIO THẬT, rồi đọc lại bằng link có chữ ký.
 *
 * Là `.integration` nên `npm test` bỏ qua: nó cần `docker compose up -d`. Chạy
 * bằng `npm run test:integration` khi đã dựng môi trường ở infra/README.md.
 *
 * Vì sao phải có bản chạy thật: những thứ hỏng ở đây không hỏng với một bản
 * giả. `forcePathStyle` là ví dụ — thiếu nó, SDK gọi `http://bucket.localhost`
 * và lỗi báo về là DNS, nên người đọc đi tìm sai chỗ. Một bản giả sẽ nhận mọi
 * lời gọi và nói đã xong.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { S3ArtifactStore, artifactKey } from '../artifacts.js';
import { uploadRunDirectory } from '../upload.js';

const store = new S3ArtifactStore({
  bucket: process.env.TESTPILOT_S3_BUCKET ?? 'testpilot-artifacts',
  region: 'us-east-1',
  endpoint: process.env.TESTPILOT_S3_ENDPOINT ?? 'http://localhost:9000',
  accessKeyId: process.env.TESTPILOT_S3_ACCESS_KEY ?? 'testpilot',
  secretAccessKey: process.env.TESTPILOT_S3_SECRET_KEY ?? 'testpilot-dev',
});

const ORG = 'org-test';
const JOB = `job-${Date.now()}`;
let runDir: string;

before(async () => {
  runDir = await mkdtemp(path.join(tmpdir(), 'tp-run-'));
  await mkdir(path.join(runDir, 'artifacts'), { recursive: true });
  await writeFile(path.join(runDir, 'index.html'), '<h1>báo cáo</h1>', 'utf8');
  await writeFile(path.join(runDir, 'meta.json'), JSON.stringify({ status: 'passed' }), 'utf8');
  await writeFile(path.join(runDir, 'artifacts', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

after(async () => {
  for (const ref of await store.list(`${ORG}/${JOB}/`)) await store.remove(ref.key);
  await rm(runDir, { recursive: true, force: true });
});

describe('MinIO thật', () => {
  it('đẩy cả thư mục lượt chạy, giữ nguyên cây thư mục', async () => {
    const result = await uploadRunDirectory(store, runDir, { orgId: ORG, jobId: JOB });

    assert.deepEqual(result.failed, [], 'không file nào được phép hỏng ở môi trường sạch');
    assert.equal(result.uploaded.length, 3);
    assert.ok(result.totalBytes > 0);

    const keys = (await store.list(`${ORG}/${JOB}/`)).map((r) => r.key).sort();
    assert.deepEqual(keys, [
      `${ORG}/${JOB}/artifacts/shot.png`,
      `${ORG}/${JOB}/index.html`,
      `${ORG}/${JOB}/meta.json`,
    ]);
  });

  it('đọc lại đúng nội dung đã ghi', async () => {
    const body = await store.get(artifactKey(ORG, JOB, 'index.html'));
    assert.equal(body.toString('utf8'), '<h1>báo cáo</h1>');
  });

  /**
   * Link có chữ ký là cách người dùng xem video mà không phải đẩy hàng chục MB
   * qua server. Nó phải mở được BẰNG HTTP THƯỜNG, không cần khoá — đó là điểm
   * của nó, và cũng là lý do hạn phải ngắn.
   */
  it('link có chữ ký mở được bằng fetch thường', async () => {
    const url = await store.signedUrl(artifactKey(ORG, JOB, 'index.html'), 60);
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '<h1>báo cáo</h1>');
  });

  it('link hết hạn thì không đọc được nữa', async () => {
    const url = await store.signedUrl(artifactKey(ORG, JOB, 'index.html'), 1);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const res = await fetch(url);
    assert.notEqual(res.status, 200, 'link quá hạn vẫn đọc được — hạn không có tác dụng');
  });

  /** Tiền tố của tổ chức này không bao giờ liệt kê ra file của tổ chức khác. */
  it('liệt kê theo tiền tố không lẫn tổ chức khác', async () => {
    await store.put(artifactKey('org-khac', JOB, 'bimat.txt'), Buffer.from('không được thấy'));
    try {
      const mine = await store.list(`${ORG}/`);
      assert.equal(mine.some((r) => r.key.includes('org-khac')), false);
      assert.ok(mine.length >= 3);
    } finally {
      await store.remove(artifactKey('org-khac', JOB, 'bimat.txt'));
    }
  });
});
