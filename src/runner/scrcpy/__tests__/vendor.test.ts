/**
 * File nhúng phải đúng là file Genymobile đã phát hành.
 *
 * Đây là nhị phân duy nhất trong repo, và nó được ĐẨY LÊN MÁY người dùng rồi
 * chạy ở đó. Một file như thế đổi nội dung mà không ai để ý là chuyện phải
 * không xảy ra được — nên checksum nằm trong test, không nằm trong một tài
 * liệu mà người ta đọc rồi tin.
 *
 * Con số này là con số Genymobile công bố trong `SHA256SUMS.txt` của bản v4.1,
 * đối chiếu tay lúc tải về.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SCRCPY_VERSION } from '../protocol.js';
import { vendoredJar } from '../session.js';

const PUBLISHED_SHA256 =
  'deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae';

describe('scrcpy-server nhúng trong repo', () => {
  it('khớp checksum bản v4.1 đã phát hành', () => {
    const bytes = readFileSync(vendoredJar());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), PUBLISHED_SHA256);
  });

  it('số hiệu trong mã trùng tên file', () => {
    // Server so chuỗi client gửi lên với số của chính nó và chết nếu lệch. Đổi
    // file mà quên đổi hằng số là hỏng ngay từ cái bắt tay — test này chỉ làm
    // nó hỏng SỚM HƠN, ở đây, thay vì trên máy ai đó.
    assert.ok(vendoredJar().endsWith(`scrcpy-server-v${SCRCPY_VERSION}`));
  });
});
