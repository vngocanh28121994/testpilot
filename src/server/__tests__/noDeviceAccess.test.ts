/**
 * Control plane không được chạy lệnh trên máy.
 *
 * Đây là ranh giới mà cả kế hoạch farm dựng nên, và nó là loại ranh giới bị phá
 * bằng những bước rất nhỏ: "chỉ thêm một `spawn` thôi, tạm thời". Mỗi bước như
 * thế đều hợp lý tại chỗ, và cộng lại thành một server chạy được lệnh tuỳ ý
 * trên máy của người dùng — thứ mà không ai đồng ý khi họ cài runner.
 *
 * Nên ranh giới này phải được canh bằng test, không bằng trí nhớ. Nếu một ngày
 * `src/server/` thật sự cần chạy một lệnh, câu trả lời là thêm một việc vào
 * `RunnerPrereqApi` — một danh sách đóng, đọc được, và người dùng xem được.
 *
 * Xem [FARM-ARCHITECTURE.md](../../../FARM-ARCHITECTURE.md) mục 12.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : filesUnder(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const serverFiles = filesUnder('src/server');

describe('ranh giới control plane', () => {
  it('không file nào trong src/server/ đụng child_process', () => {
    const offenders = serverFiles.filter((file) =>
      /child_process|\bspawn\(|execFile\(/.test(readFileSync(file, 'utf8')));
    assert.deepEqual(
      offenders,
      [],
      `${offenders.join(', ')} chạy lệnh trên máy. Việc ấy thuộc về src/runner/, `
        + 'và phải đi qua một việc đã khai báo trong RunnerPrereqApi.',
    );
  });

  it('không file nào trong src/server/ gọi thẳng vào prereq của runner', () => {
    const offenders = serverFiles.filter((file) =>
      /from '.*runner\/prereq\.js'/.test(readFileSync(file, 'utf8')));
    assert.deepEqual(
      offenders,
      [],
      `${offenders.join(', ')} import thẳng prereq.ts. Phải đi qua localRunner: `
        + 'ở chế độ server, phía bên kia không còn là một lời gọi hàm.',
    );
  });

  /**
   * Danh sách việc runner nhận là một lời hứa với người cài nó lên máy mình.
   * Nó dài ra được — nhưng phải là một quyết định, không phải một lần tiện tay.
   */
  it('RunnerPrereqApi vẫn là danh sách đóng', async () => {
    const { localRunner } = await import('../../runner/index.js');
    assert.deepEqual(Object.keys(localRunner.prereq).sort(), [
      'androidDevices',
      'appiumStatus',
      'installDriver',
      'iosDevices',
      'iosNames',
      'openIosSettings',
      'openTunnelTerminal',
      'restartAppium',
      'startAppium',
      'xcode',
    ]);
  });

  /**
   * Cả bốn nhóm việc, không chỉ prereq. Bài test này từng chỉ canh `prereq` và
   * đã bỏ lọt `readAppVersion` (chạy `aapt`) vào `src/server/routes/builds.ts`
   * ở nhóm 4 — chỗ đó bắt control plane phải có Android SDK để trả lời một câu
   * hỏi về file.
   */
  it('facade có đúng năm nhóm việc', async () => {
    const { localRunner } = await import('../../runner/index.js');
    assert.deepEqual(
      Object.keys(localRunner).sort(),
      ['builds', 'control', 'farm', 'prereq', 'run'],
    );
  });

  /**
   * Nhóm `control` là nhóm gắt nhất, vì nó đưa cho phía bên kia quyền điều
   * khiển một chiếc điện thoại thật đang cắm trên máy của một con người: gõ
   * được vào ứng dụng đang mở, bấm được nút xác nhận.
   *
   * Nên nó nhận đúng bốn động tác, không nhận "một lệnh input bất kỳ". Danh
   * sách dài ra được, nhưng phải là một quyết định — và bài test này là chỗ
   * quyết định ấy để lại dấu.
   */
  it('RunnerControlApi vẫn là danh sách đóng', async () => {
    const { localRunner } = await import('../../runner/index.js');
    assert.deepEqual(Object.keys(localRunner.control).sort(), [
      'pressKey',
      'screenSize',
      'startScreenStream',
      'swipe',
      'tap',
      'typeText',
    ]);
  });

  /** Không có POWER/SLEEP: một nút trên web khoá màn hình chiếc máy ở phòng khác. */
  it('danh sách phím không có phím nguồn', async () => {
    const { controlKeys } = await import('../../runner/control.js');
    assert.deepEqual(controlKeys().sort(), [
      'back', 'delete', 'enter', 'home', 'recents', 'tab',
    ]);
  });
});
