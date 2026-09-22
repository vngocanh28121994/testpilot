/**
 * Runner tự cập nhật khi server nâng major.
 *
 * Bài đáng giá nhất ở đây không phải đường thành công mà là hai lần TỪ CHỐI:
 * không cấu hình gói thì không tự cài gì cả, và tên gói không hợp lệ thì không
 * chạy lệnh nào. Cả hai đều bảo vệ cùng một thứ — một câu lệnh cài đặt chạy
 * trên hai mươi chiếc máy có Xcode và keychain của người thật.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyUpdate, EXIT_UPDATED, planUpdate } from '../update.js';

describe('kế hoạch cập nhật', () => {
  it('không đặt tên gói thì KHÔNG tự cập nhật', () => {
    // Mặc định là tắt, và đó là chủ ý: một runner chạy từ mã nguồn mà tự
    // `npm install -g` lên chính nó sẽ cài đè bản đang phát triển.
    assert.equal(planUpdate({}), undefined);
    assert.equal(planUpdate({ TESTPILOT_RUNNER_PACKAGE: '   ' }), undefined);
  });

  it('thẻ mặc định là latest', () => {
    assert.deepEqual(planUpdate({ TESTPILOT_RUNNER_PACKAGE: '@x/runner' }), {
      packageName: '@x/runner', tag: 'latest',
    });
    assert.deepEqual(
      planUpdate({ TESTPILOT_RUNNER_PACKAGE: '@x/runner', TESTPILOT_RUNNER_CHANNEL: 'next' }),
      { packageName: '@x/runner', tag: 'next' },
    );
  });
});

describe('cài bản mới', () => {
  it('gọi đúng một lệnh với gói và thẻ đã cấu hình', async () => {
    const calls: unknown[] = [];
    const outcome = await applyUpdate({ packageName: '@x/runner', tag: 'latest' }, async (plan) => {
      calls.push(plan);
      return 0;
    });
    assert.equal(outcome.ok, true);
    assert.deepEqual(calls, [{ packageName: '@x/runner', tag: 'latest' }]);
    assert.match(outcome.message, /Thoát để bộ giám sát dựng lại/);
  });

  it('tên gói lạ thì KHÔNG chạy lệnh nào', async () => {
    let ran = false;
    const outcome = await applyUpdate(
      { packageName: 'runner; rm -rf /', tag: 'latest' },
      async () => { ran = true; return 0; },
    );
    assert.equal(outcome.ok, false);
    assert.equal(ran, false, 'không được chạy gì với một tên gói không hợp lệ');
  });

  it('thẻ lạ cũng thế', async () => {
    let ran = false;
    const outcome = await applyUpdate(
      { packageName: '@x/runner', tag: '$(whoami)' },
      async () => { ran = true; return 0; },
    );
    assert.equal(outcome.ok, false);
    assert.equal(ran, false);
  });

  it('cài hỏng thì nói mã lỗi, không giả vờ đã xong', async () => {
    const outcome = await applyUpdate({ packageName: '@x/runner', tag: 'latest' }, async () => 1);
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /hỏng \(mã 1\)/);
  });

  it('lệnh ném thì vẫn trả lời, không để lời hứa treo', async () => {
    const outcome = await applyUpdate(
      { packageName: '@x/runner', tag: 'latest' },
      async () => { throw new Error('npm không có trên PATH'); },
    );
    assert.equal(outcome.ok, false);
  });
});

describe('mã thoát', () => {
  it('75 là EX_TEMPFAIL — cùng số mà systemd đang khai SuccessExitStatus', () => {
    // Con số này nằm ở BA chỗ: ở đây, trong unit file systemd, và trong bảng
    // ở packaging/README.md. Lệch một chỗ thì bộ giám sát ghi "failed" vào log
    // cho một lần thoát hoàn toàn bình thường, và người trực đêm đọc đúng dòng ấy.
    assert.equal(EXIT_UPDATED, 75);
  });
});
