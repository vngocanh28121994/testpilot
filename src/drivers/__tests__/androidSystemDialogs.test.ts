import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const nativeSource = readFileSync('src/drivers/native.ts', 'utf8');

describe('popup hệ điều hành Android', () => {
  it('chờ permission dialog xuất hiện trễ sau khi cài app', () => {
    const clear = nativeSource.slice(nativeSource.indexOf('private async clearBlockingDialogs'));
    assert.match(clear, /const arrivalDeadline = Date\.now\(\) \+ waitForArrivalMs/);
    assert.match(clear, /if \(Date\.now\(\) >= arrivalDeadline\) return/);
    assert.match(nativeSource, /this\.opts\.enforceAppInstall \? 3_000 : 0/);
  });

  it('quét system dialog ngay sau khi đóng lớp popup DOM bên trên', () => {
    const dismiss = nativeSource.slice(
      nativeSource.indexOf('async dismissOverlay'),
      nativeSource.indexOf('private async dismissIosOverlay'),
    );
    assert.match(dismiss, /if \(dismissed\) \{[\s\S]*clearBlockingDialogs\(5, 600\)/);
  });

  it('chỉ báo số permission mà adb thực sự cấp thành công', () => {
    const grant = nativeSource.slice(
      nativeSource.indexOf('private async grantPendingPermissions'),
      nativeSource.indexOf('private async killWebViewApps'),
    );
    assert.match(grant, /const granted: string\[\] = \[\]/);
    assert.match(grant, /granted\.length/);
    assert.doesNotMatch(grant, /granted \$\{pending\.length\}/);
  });
});
