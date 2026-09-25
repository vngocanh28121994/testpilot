/**
 * "Test kết thúc với lỗi (mã 1)" là câu thật đã hiện cho một lượt Android hỏng
 * vì Appium thiếu ANDROID_HOME — không nói được là do máy, do app hay do kịch
 * bản. Câu tóm tắt của job phải mang nguyên nhân có sẵn trong log.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { failureHint } from '../worker.js';

describe('failureHint', () => {
  it('lỗi làm cả lượt dừng: lấy dòng [run] đầu khối lỗi, không lấy dòng hướng dẫn', () => {
    const lines = [
      '[run:env] prod — dùng app đã cài sẵn trên máy',
      '[native] granted 4 pending runtime permission(s) to com.fss.tcbs.mobiletrading',
      '[run] Appium thiếu biến môi trường ANDROID_HOME.',
      'Hãy khởi động Appium từ terminal đã load shell profile, hoặc chạy:',
      '  export ANDROID_HOME=$HOME/Library/Android/sdk',
      '  appium',
    ];
    assert.equal(failureHint(lines), 'Appium thiếu biến môi trường ANDROID_HOME.');
  });

  it('kịch bản không đạt: nêu tên, không nêu dòng tóm tắt', () => {
    const lines = [
      '[run:failed] ✗ Đăng nhập thành công vào tài khoản',
      '[run:summary] 0✓ 1✗ 0~ 0⊘',
      '[run] report -> runs/x/index.html',
      '[run] 1 scenario(s) failed.',
    ];
    assert.match(failureHint(lines) ?? '', /^1 kịch bản không đạt: Đăng nhập thành công vào tài khoản/);
  });

  it('không có gì giống lỗi: không bịa', () => {
    assert.equal(failureHint(['[run:dir] runs/x', 'xong']), undefined);
  });
});
