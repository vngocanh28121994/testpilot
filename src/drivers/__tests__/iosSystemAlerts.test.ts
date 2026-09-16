import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chooseIosSystemAlertButton } from '../native.js';

const nativeSource = readFileSync('src/drivers/native.ts', 'utf8');

describe('popup hệ điều hành iOS', () => {
  it('xử lý nhiều nhóm permission bằng cùng một policy', () => {
    assert.equal(chooseIosSystemAlertButton(["Don’t Allow", 'Allow']), 'Allow');
    assert.equal(
      chooseIosSystemAlertButton(["Don’t Allow", 'Allow Once', 'Allow While Using App']),
      'Allow While Using App',
    );
    assert.equal(
      chooseIosSystemAlertButton(['Select Photos…', 'Allow Full Access', "Don’t Allow"]),
      'Allow Full Access',
    );
    assert.equal(
      chooseIosSystemAlertButton(['Yêu cầu ứng dụng không theo dõi', 'Cho phép']),
      'Cho phép',
    );
  });

  it('hiểu apostrophe Unicode nhưng giữ nguyên label Appium trả về', () => {
    assert.equal(chooseIosSystemAlertButton(["Don’t Allow"]), "Don’t Allow");
  });

  it('không tự bấm hành động nghiệp vụ hoặc nguy hiểm', () => {
    assert.equal(chooseIosSystemAlertButton(['Delete', 'Buy', 'Update']), undefined);
  });

  it('nhìn thấy popup của SpringBoard và quét lại popup xuất hiện trễ', () => {
    assert.match(nativeSource, /updateSettings\(\{ respectSystemAlerts: true \}\)/);
    assert.match(nativeSource, /clearBlockingDialogs\(5, isAndroid \? 0 : 3_000\)/);
    assert.match(nativeSource, /if \(this\.opts\.platform === 'ios'\) await this\.clearBlockingDialogs\(\)/);
  });
});
