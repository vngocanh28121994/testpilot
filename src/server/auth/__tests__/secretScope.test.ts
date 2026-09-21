/**
 * Khoá của một tổ chức không được phục vụ tổ chức khác.
 *
 * Kiểu hỏng cần chặn ở đây im lặng và tốn tiền: `process.env` là một không
 * gian phẳng, nên người lưu khoá sau cùng sẽ vô tình trả tiền cho mọi request
 * của mọi tổ chức — và trong log thì mọi thứ trông bình thường. Chỉ hoá đơn
 * cuối tháng nói ra sự thật, và nó không nói ai.
 *
 * Ba đường rò, cả ba đều phải đóng: ghi vào env khi lưu, nạp env lúc khởi
 * động, và ĐỌC env làm phương án dự phòng khi kho chưa có gì.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MemorySecretStore,
  MANAGED_SECRETS,
  mayAdoptIntoEnv,
  secretsForJob,
} from '../secrets.js';

const configRoute = readFileSync('src/server/routes/config.ts', 'utf8');
const bootstrap = readFileSync('src/ui/server.ts', 'utf8');

describe('kho khoá tách theo tổ chức', () => {
  it('hai tổ chức không thấy khoá của nhau', async () => {
    const store = new MemorySecretStore();
    await store.set('org-a', 'GEMINI_API_KEY', 'khoa-cua-a');

    assert.equal(await store.get('org-a', 'GEMINI_API_KEY'), 'khoa-cua-a');
    assert.equal(await store.get('org-b', 'GEMINI_API_KEY'), undefined);
    assert.equal(await store.has('org-b', 'GEMINI_API_KEY'), false);
    assert.deepEqual(await store.names('org-b'), []);
  });

  it('liệt kê tên, không bao giờ liệt kê giá trị', async () => {
    const store = new MemorySecretStore();
    await store.set('org-a', 'GEMINI_API_KEY', 'bi-mat');
    await store.set('org-a', 'CONFLUENCE_API_TOKEN', 'bi-mat-2');

    const names = await store.names('org-a');
    assert.deepEqual(names, ['CONFLUENCE_API_TOKEN', 'GEMINI_API_KEY']);
    assert.ok(!JSON.stringify(names).includes('bi-mat'));
  });
});

describe('cấp khoá cho một job', () => {
  /**
   * Cấp cả túi rẻ hơn một dòng code và đắt hơn nhiều về sau: một job chỉ cần
   * đọc Confluence sẽ mang khoá model của cả tổ chức xuống máy cá nhân của
   * một người, và nằm lại trong `process.env` của một tiến trình không ai nhớ.
   */
  it('chỉ cấp đúng những tên job cần', async () => {
    const store = new MemorySecretStore();
    await store.set('org-a', 'GEMINI_API_KEY', 'g');
    await store.set('org-a', 'ANTHROPIC_API_KEY', 'a');
    await store.set('org-a', 'CONFLUENCE_API_TOKEN', 'c');

    const granted = await secretsForJob(store, 'org-a', ['CONFLUENCE_API_TOKEN']);
    assert.deepEqual(Object.keys(granted), ['CONFLUENCE_API_TOKEN']);
  });

  /**
   * Tên không có thì VẮNG MẶT, không phải chuỗi rỗng. Chuỗi rỗng đi tiếp xuống
   * dưới rồi hỏng ở chỗ khác, với thông báo nói về HTTP 401 chứ không nói về
   * một khoá chưa cấu hình.
   */
  it('khoá chưa cấu hình thì vắng mặt, không phải chuỗi rỗng', async () => {
    const store = new MemorySecretStore();
    const granted = await secretsForJob(store, 'org-a', ['GEMINI_API_KEY']);
    assert.deepEqual(granted, {});
    assert.equal('GEMINI_API_KEY' in granted, false);
  });

  it('không lấy nhầm khoá của tổ chức khác', async () => {
    const store = new MemorySecretStore();
    await store.set('org-b', 'GEMINI_API_KEY', 'cua-b');
    assert.deepEqual(await secretsForJob(store, 'org-a', ['GEMINI_API_KEY']), {});
  });
});

describe('ranh giới process.env', () => {
  it('chỉ embedded mới được nạp khoá vào môi trường tiến trình', () => {
    assert.equal(mayAdoptIntoEnv('embedded'), true);
    assert.equal(mayAdoptIntoEnv('server'), false);
  });

  /** Đường rò thứ nhất: ghi vào env mỗi lần ai đó lưu một khoá. */
  it('route lưu khoá không ghi thẳng vào process.env', () => {
    const writes = [...configRoute.matchAll(/process\.env\[[^\]]+\]\s*=/g)];
    for (const write of writes) {
      const before = configRoute.slice(Math.max(0, write.index! - 200), write.index!);
      assert.match(
        before,
        /mayAdoptIntoEnv\(/,
        'mọi lần ghi vào process.env phải nằm sau cổng mayAdoptIntoEnv',
      );
    }
    assert.doesNotMatch(configRoute, /process\.env\.CONFLUENCE_API_TOKEN\s*=/);
  });

  /** Đường rò thứ hai: nạp cả file khoá vào env lúc khởi động. */
  it('khởi động chỉ nạp khoá khi ở chế độ embedded', () => {
    assert.match(bootstrap, /if \(mayAdoptIntoEnv\(serverMode\(\)\)\) await adoptStoredApiKeys\(\)/);
  });

  /**
   * Đường rò thứ ba, kín đáo nhất: kho chưa có gì thì đọc biến môi trường. Ở
   * chế độ server, điều đó nghĩa là tổ chức chưa cấu hình gì sẽ lặng lẽ dùng
   * khoá của người dựng server.
   */
  it('phương án dự phòng bằng biến môi trường cũng chỉ dành cho embedded', () => {
    assert.match(configRoute, /function envFallback/);
    assert.match(configRoute, /mayAdoptIntoEnv\(serverMode\(\)\) \? process\.env\[name\] : undefined/);
  });

  it('danh sách khoá hệ thống quản không rỗng và không trùng', () => {
    assert.ok(MANAGED_SECRETS.length >= 5);
    assert.equal(new Set(MANAGED_SECRETS).size, MANAGED_SECRETS.length);
  });
});
