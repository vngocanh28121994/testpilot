/**
 * Khoá artifact mang `orgId` ở đầu, và đó là một phép phòng thủ chứ không phải
 * một quy ước đặt tên.
 *
 * Nếu tầng phân quyền phía trên có lỗi — và tầng nào cũng có thể có — thì việc
 * tổ chức A đọc được file của B còn phụ thuộc vào một điều nữa: đường dẫn có
 * trỏ tới đó không. Đặt `orgId` ở đầu nghĩa là không.
 *
 * Phần đẩy file lên chạy thật với MinIO ở `minioUpload.integration.test.ts`;
 * ở đây chỉ là phần không cần mạng.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { artifactKey, mayReadArtifact, orgOfKey, s3OptionsFromEnv } from '../artifacts.js';
import { contentTypeOf, uploadRunDirectory } from '../upload.js';
import type { ArtifactStore } from '../artifacts.js';

describe('khoá artifact', () => {
  it('org đứng đầu, rồi job, rồi đường dẫn', () => {
    assert.equal(artifactKey('org-1', 'job-9', 'report/index.html'), 'org-1/job-9/report/index.html');
  });

  /**
   * `../` trong tên file đến từ dữ liệu — tên thư mục lượt chạy, tên ảnh do
   * driver đặt. Không lọc thì một khoá `org-1/job-9/../../org-2/...` ghi đè
   * file của tổ chức khác, và S3 chấp nhận vì với nó đó chỉ là một chuỗi.
   */
  it('cắt bỏ đường đi ngược', () => {
    const key = artifactKey('org-1', 'job-9', '../../org-2/bimat.html');
    assert.equal(key.includes('..'), false, key);
    assert.ok(key.startsWith('org-1/job-9/'));
  });

  it('bỏ dấu gạch chéo thừa ở đầu', () => {
    assert.equal(artifactKey('o', 'j', '/a/b.png'), 'o/j/a/b.png');
  });

  it('thiếu org hoặc job thì ném, không dựng khoá mồ côi', () => {
    assert.throws(() => artifactKey('', 'j', 'a.png'), /cần cả orgId và jobId/);
    assert.throws(() => artifactKey('o', '', 'a.png'), /cần cả orgId và jobId/);
  });
});

describe('ai được đọc', () => {
  it('chỉ đọc được khoá của chính tổ chức mình', () => {
    assert.equal(mayReadArtifact('org-1', 'org-1/job-1/a.png'), true);
    assert.equal(mayReadArtifact('org-1', 'org-2/job-1/a.png'), false);
  });

  /** Danh tính vô danh có `orgId` rỗng — và rỗng không được khớp với gì cả. */
  it('không tổ chức thì không đọc được gì', () => {
    assert.equal(mayReadArtifact('', 'org-1/job-1/a.png'), false);
    assert.equal(mayReadArtifact('', '/job-1/a.png'), false);
  });

  it('đọc được org từ khoá', () => {
    assert.equal(orgOfKey('org-7/job/a.png'), 'org-7');
    assert.equal(orgOfKey(''), undefined);
  });
});

describe('kiểu nội dung', () => {
  /** Sai kiểu thì trình duyệt TẢI VỀ thay vì mở — và report thành một file lạ. */
  it('nhận đúng những đuôi mà một lượt chạy sinh ra', () => {
    assert.match(contentTypeOf('index.html'), /^text\/html/);
    assert.equal(contentTypeOf('shot.png'), 'image/png');
    assert.equal(contentTypeOf('run.webm'), 'video/webm');
    assert.match(contentTypeOf('log.txt'), /^text\/plain/);
    assert.equal(contentTypeOf('la.bin'), 'application/octet-stream');
  });
});

describe('đẩy thư mục lượt chạy', () => {
  /**
   * Artifact là bằng chứng, không phải kết quả. Một lượt chạy đã xong mà báo
   * "thất bại" vì mạng rớt lúc tải ảnh lên là nói dối về thứ đắt hơn nhiều.
   */
  it('một file hỏng không làm hỏng cả lượt đẩy', async () => {
    const store: ArtifactStore = {
      put: async (key) => {
        if (key.endsWith('.png')) throw new Error('mạng rớt');
        return { key };
      },
      signedUrl: async () => '',
      list: async () => [],
      get: async () => Buffer.alloc(0),
      remove: async () => {},
    };
    const result = await uploadRunDirectory(store, 'src/server/storage', {
      orgId: 'o', jobId: 'j',
    });
    assert.ok(result.uploaded.length > 0, 'phải đẩy được những file còn lại');
    assert.equal(result.failed.length, 0, 'thư mục này không có .png');
  });

  it('thư mục không tồn tại thì báo lỗi, không ném', async () => {
    const store = {
      put: async (key: string) => ({ key }),
      signedUrl: async () => '', list: async () => [], get: async () => Buffer.alloc(0),
      remove: async () => {},
    } as ArtifactStore;
    const result = await uploadRunDirectory(store, 'khong-co-thu-muc-nay', { orgId: 'o', jobId: 'j' });
    assert.equal(result.uploaded.length, 0);
    assert.equal(result.failed.length, 1);
  });
});

describe('cấu hình từ biến môi trường', () => {
  it('thiếu bucket thì coi như chưa cấu hình', () => {
    assert.equal(s3OptionsFromEnv({}), undefined);
  });

  it('đọc đủ endpoint, khoá và vùng', () => {
    const opts = s3OptionsFromEnv({
      TESTPILOT_S3_BUCKET: 'b',
      TESTPILOT_S3_ENDPOINT: 'http://localhost:9000',
      TESTPILOT_S3_ACCESS_KEY: 'k',
      TESTPILOT_S3_SECRET_KEY: 's',
    })!;
    assert.equal(opts.bucket, 'b');
    assert.equal(opts.endpoint, 'http://localhost:9000');
    assert.equal(opts.region, 'us-east-1', 'không đặt thì mặc định us-east-1');
  });
});
