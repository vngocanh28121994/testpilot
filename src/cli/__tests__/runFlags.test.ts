/**
 * `run.ts --help` từng chạy THẬT toàn bộ kịch bản trên prod — bắt đầu bằng
 * "Chuyển tiền thành công" với tài khoản thật — vì cờ lạ bị bỏ qua.
 *
 * Mọi lệnh ở đây đều trỏ `--config` vào một file không tồn tại: nếu phép chặn
 * hỏng, lượt chạy dừng ở bước nạp config chứ không chạm tới app nào.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

const SAFE = ['--config', '/khong-ton-tai/testpilot.config.json'];

function run(args: string[]) {
  return spawnSync('npx', ['tsx', 'src/cli/run.ts', ...args, ...SAFE], { encoding: 'utf8', timeout: 60_000 });
}

describe('run.ts: cờ lạ thì dừng', () => {
  it('--help in cách dùng và thoát 0, không nạp config', () => {
    const out = run(['--help']);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /Dùng: tsx src\/cli\/run\.ts/);
  });

  it('cờ gõ sai: báo lỗi, thoát khác 0, không chạy gì', () => {
    const out = run(['--platform', 'web', '--feture', 'x.feature']);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /Không hiểu tham số "--feture"/);
  });

  it('cờ cần giá trị mà thiếu: báo lỗi', () => {
    const out = run(['--platform', 'web', '--env']);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /--env cần một giá trị/);
  });
});
