/**
 * `JobSpec` phải phủ đúng những gì `POST /api/run` đang nhận.
 *
 * Đây là bài test chống trôi của cả P1: việc tách runner ra khỏi server chỉ an
 * toàn khi mọi thứ endpoint ấy nhận đều có chỗ trong hợp đồng. Một trường bị
 * bỏ quên không làm gì đổ — nó lặng lẽ biến mất trên đường đi, và lượt chạy
 * nhận giá trị mặc định thay vì giá trị người dùng chọn. `headed` mất theo
 * kiểu đó thì người ta bấm "chạy có giao diện" và nhìn một lượt chạy headless.
 *
 * Đọc thẳng từ mã nguồn `server.ts` thay vì chép lại danh sách trường: chép
 * lại là tạo ra bản sao thứ hai cần đồng bộ, đúng thứ bài test này sinh ra để
 * ngăn.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { JobSpec, RunSuiteParams } from '../messages.js';
import { PROTOCOL_VERSION, isCompatible, parseVersion } from '../version.js';

/**
 * Các trường trong `readJson<{…}>` của handler `POST /api/run`.
 *
 * Route rời `server.ts` sang `src/server/routes/run.ts` ở P1 (2026-09-21).
 * Điều bài test này canh không đổi: hợp đồng `JobSpec` phải phủ đúng những gì
 * endpoint đang nhận.
 */
function runApiFields(): string[] {
  const source = readFileSync('src/server/routes/run.ts', 'utf8');
  const at = source.indexOf("'POST /api/run': async");
  assert.ok(at > 0, 'không còn thấy route POST /api/run — bản đồ route đã đổi, đọc lại test này');
  const block = source.slice(at, source.indexOf('>(req);', at));
  const body = block.slice(block.indexOf('readJson<{') + 'readJson<{'.length);
  return [...body.matchAll(/(\w+)\??\s*:/g)].map((m) => m[1]!);
}

describe('JobSpec phủ hết POST /api/run', () => {
  it('mọi trường của body hiện tại đều có chỗ trong JobSpec', () => {
    // Ánh xạ: trường nào của API nằm ở đâu trong JobSpec. `devices` đổi tên
    // thành `deviceTokens` vì nó luôn là `platform:id`, và cái tên cũ đã khiến
    // người ta tưởng có thể truyền id trần.
    const home: Record<string, keyof JobSpec | keyof RunSuiteParams> = {
      platform: 'platform',
      tag: 'tag',
      headed: 'headed',
      includeQuarantined: 'includeQuarantined',
      devices: 'deviceTokens',
      env: 'env',
      appSource: 'appSource',
    };

    const missing = runApiFields().filter((field) => !(field in home));
    assert.deepEqual(
      missing,
      [],
      `POST /api/run có trường chưa có chỗ trong JobSpec: ${missing.join(', ')}. `
        + 'Thêm vào RunSuiteParams (hoặc JobSpec) rồi cập nhật bảng ánh xạ ở đây.',
    );
  });

  /** Kiểu phải dùng được thật, không chỉ tồn tại. */
  it('dựng được một JobSpec đầy đủ', () => {
    const spec: JobSpec = {
      jobId: 'job-1',
      orgId: 'org-1',
      kind: 'run_suite',
      createdBy: 'user-1',
      timeoutMs: 600_000,
      deviceTokens: ['android:emulator-5554'],
      run: {
        platform: 'android',
        tag: '@smoke',
        headed: false,
        includeQuarantined: false,
        env: 'sit',
        appSource: 'upload',
        appBuilds: { android: { key: 'build/sit/app-sit.apk', name: 'app-sit.apk', sha256: 'ab', size: 1 } },
      },
      snapshot: { registryRevision: 'r42', registry: {}, features: [] },
    };
    assert.equal(spec.run?.tag, '@smoke');
    assert.equal(spec.deviceTokens.length, 1);
  });
});

describe('phiên bản giao thức', () => {
  it('cùng major thì chạy, khác major thì không', () => {
    assert.equal(isCompatible('1.0.0', '1.4.2'), true, 'runner mới hơn ở minor vẫn phải chạy');
    assert.equal(isCompatible('1.3.0', '1.0.0'), true, 'runner cũ hơn ở minor vẫn phải chạy');
    assert.equal(isCompatible('2.0.0', '1.9.9'), false);
  });

  /** Chuỗi lạ là runner lạ hoặc bản build hỏng. Đoán bừa ở đây là gửi job thật cho nó. */
  it('phiên bản không đọc được thì không tương thích', () => {
    assert.equal(parseVersion('mới nhất'), undefined);
    assert.equal(isCompatible('1.0.0', 'mới nhất'), false);
    assert.equal(isCompatible('1.0.0', ''), false);
  });

  it('phiên bản hiện tại là semver hợp lệ', () => {
    assert.notEqual(parseVersion(PROTOCOL_VERSION), undefined);
  });
});
