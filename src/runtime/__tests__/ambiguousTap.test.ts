/**
 * Bấm là hành động không lấy lại được, nên "chọn đại" phải bị từ chối trước
 * khi bấm.
 *
 * Đo trên máy thật ngày 2026-09-15: `mat-icon.mat-menu-trigger` của "Nút tùy
 * chọn dòng" khớp 53 phần tử, 20 cái đang hiển thị — mỗi dòng cổ phiếu một
 * cái. Runner bấm dòng đầu, postcondition không xảy ra, healing thử lại bốn
 * lần và cả bốn lần bấm đúng dòng đó. Không có gì hỏng ở tầng dưới: locator
 * hợp lệ, phần tử có thật, cú bấm thành công — chỉ là bấm nhầm dòng, và thông
 * báo cuối cùng không nói được điều đó.
 *
 * Ranh giới quan trọng nằm ở hướng ngược lại: khớp nhiều KHÔNG phải là lỗi.
 * Cùng lượt chạy ấy, `label="add"` khớp 3 phần tử và `label="TIẾP TỤC"` khớp
 * 2, cả hai đều được lớp dialog trên cùng thu hẹp và cả hai đều đúng. Một luật
 * chỉ biết đếm sẽ giết chúng.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const executor = readFileSync('src/runtime/executor.ts', 'utf8');
const cdp = readFileSync('src/drivers/WebViewCdpDriver.ts', 'utf8');

describe('không bấm khi phải chọn đại', () => {
  it('cổng chặn nằm TRƯỚC driver.tap, không phải sau postcondition', () => {
    const gate = executor.indexOf('matches?.ambiguousForAction');
    const tap = executor.indexOf('await this.driver.tap(anchored)');
    assert.ok(gate > -1, 'phải có cổng chặn');
    assert.ok(gate < tap, 'cổng phải đứng trước cú bấm');
  });

  it('ứng viên mơ hồ bị loại rồi thử tiếp, không làm hỏng luôn cả bước', () => {
    const block = executor.slice(executor.indexOf('matches?.ambiguousForAction'));
    const body = block.slice(0, block.indexOf('phaseStarted = Date.now()'));
    assert.match(body, /excluded\.add\(candidateKey\(r\.candidate\)\)/);
    assert.match(body, /continue;/);
  });

  /**
   * `undefined` là "driver không trả lời được", không phải "có". Nếu đọc nhầm
   * hai thứ đó thành một thì mọi locator hợp lệ chạy trên driver không thu hẹp
   * được — web thuần, Appium native — đều bị chặn oan.
   */
  it('chỉ chặn khi driver tự khẳng định, không chặn khi không biết', () => {
    const block = executor.slice(executor.indexOf('const matches = this.driver.inspectMatches'));
    const body = block.slice(0, block.indexOf('continue;'));
    assert.match(body, /if \(matches\?\.ambiguousForAction &&/);
    assert.doesNotMatch(body, /matches\.count > 1|!matches\b/);
  });

  /**
   * Cổng chặn phải hỏi CẢ lịch sử, không chỉ hỏi driver.
   *
   * Bản đầu chỉ hỏi driver, và lượt chạy thật ngay sau đó biến bốn kịch bản
   * đang xanh thành đỏ: `label="THÊM MÃ"` khớp 2 phần tử, không lớp nào thu
   * hẹp — đúng định nghĩa "mơ hồ" của driver — nhưng nó đã thắng 10 lần và
   * phần tử đầu tiên vẫn luôn là cái đúng. Cùng tối ấy
   * `mat-icon.mat-menu-trigger` khớp 53 và thắng 0 lần. Số khớp không phân
   * biệt được hai chuyện đó; lịch sử thì có.
   */
  it('locator đã từng chứng minh được kết quả thì không bị chặn', () => {
    const block = executor.slice(executor.indexOf('const matches = this.driver.inspectMatches'));
    const body = block.slice(0, block.indexOf('continue;'));
    assert.match(body, /provenWins\(definition, r\.candidate\)/);
    assert.match(body, /matches\?\.ambiguousForAction && proven === 0/);
  });

  /**
   * Cờ phải được tính theo căn cứ chọn, không theo số lượng: có lớp modal thu
   * hẹp thì không mơ hồ, và đúng một phần tử bấm được thì cũng không.
   */
  it('driver tính cờ theo căn cứ chọn, không theo số khớp', () => {
    const block = cdp.slice(cdp.indexOf('private async pickWouldBeArbitrary'));
    const body = block.slice(0, block.indexOf('\n  }'));
    assert.match(body, /if \(visible <= 1\) return false;/);
    assert.match(body, /inFrontModal\(locator\)[\s\S]{0,40}return false;/);
    assert.match(body, /hittable > 1\) return true;/);
  });
});
