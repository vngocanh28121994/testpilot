/**
 * "Chạy đúng các case positive của MỘT chức năng" — trước đây không nói được.
 *
 * Dấu phẩy vốn là "hoặc", nên chọn @feature-chuyen-tien và @positive cho ra
 * positive của MỌI chức năng. Thêm dấu cộng cho "và", giữ nguyên dấu phẩy để
 * lệnh và lịch chạy cũ không đổi nghĩa.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  matchesTagExpression,
  platformsForTags,
  scenarioInRunScope,
} from '../../core/tagScope.js';

const source = readFileSync('src/cli/run.ts', 'utf8');
const executorSource = readFileSync('src/runtime/Executor.ts', 'utf8');
const nativeDriverSource = readFileSync('src/drivers/native.ts', 'utf8');

/** Bản sao đúng bằng biểu thức trong run.ts; test bên dưới canh cho nó không lệch. */
function inScope(tagArg: string, scenarioTags: string[]): boolean {
  return matchesTagExpression(tagArg, scenarioTags);
}

const transferPositive = ['@feature-chuyen-tien', '@positive', '@p0'];
const transferNegative = ['@feature-chuyen-tien', '@negative'];
const stockPositive = ['@feature-them-ma', '@positive'];

describe('phạm vi tag của một lượt chạy', () => {
  it('dấu cộng là VÀ: chỉ positive của đúng chức năng đó', () => {
    const expr = '@feature-chuyen-tien+@positive';
    assert.equal(inScope(expr, transferPositive), true);
    assert.equal(inScope(expr, transferNegative), false);
    assert.equal(inScope(expr, stockPositive), false);
  });

  it('dấu phẩy vẫn là HOẶC, như trước', () => {
    const expr = '@feature-chuyen-tien,@feature-them-ma';
    assert.equal(inScope(expr, transferNegative), true);
    assert.equal(inScope(expr, stockPositive), true);
    assert.equal(inScope(expr, ['@feature-khac']), false);
  });

  it('trộn được: (@a và @b) hoặc @c', () => {
    const expr = '@feature-chuyen-tien+@positive,@p0';
    assert.equal(inScope(expr, transferPositive), true);
    assert.equal(inScope(expr, ['@p0']), true);
    assert.equal(inScope(expr, stockPositive), false);
  });

  it('không chọn tag nào thì chạy tất cả', () => {
    assert.equal(inScope('', transferNegative), true);
  });

  it('không kéo native vào lượt WebView mặc định hoặc bộ lọc rộng', () => {
    const nativeRegression = ['@native', '@regression', '@p0'];
    assert.equal(inScope('', nativeRegression), false);
    assert.equal(inScope('@regression', nativeRegression), false);
    assert.equal(inScope('@p0', nativeRegression), false);
  });

  it('chỉ chạy native khi chính nhánh lọc đó ghi rõ @native', () => {
    const nativeRegression = ['@native', '@regression', '@p0'];
    assert.equal(inScope('@native', nativeRegression), true);
    assert.equal(inScope('@native+@regression', nativeRegression), true);
    assert.equal(inScope('@native+@negative', nativeRegression), false);
    assert.equal(inScope('@p0,@native', nativeRegression), true);
  });

  it('native không có platform tag chỉ định tuyến mobile, không chạy web', () => {
    assert.deepEqual(platformsForTags(['@native']), ['android', 'ios']);
    assert.deepEqual(platformsForTags(['@native', '@ios']), ['ios']);
    assert.deepEqual(platformsForTags(['@regression']), ['web', 'android', 'ios']);
    const scenario = { tags: ['@native', '@regression'], platforms: platformsForTags(['@native']) };
    assert.equal(scenarioInRunScope('@native+@regression', scenario, 'web'), false);
    assert.equal(scenarioInRunScope('@native+@regression', scenario, 'android'), true);
  });

  /** Bản sao ở trên chỉ có giá trị khi run.ts thật sự làm như vậy. */
  it('run.ts dùng đúng cách tách đó', () => {
    assert.match(source, /scenarioInRunScope\(args\.tag, scenario, platform\)/);
  });

  it('executor chọn native mode theo tag của từng scenario', () => {
    assert.match(
      executorSource,
      /setScenarioMode\?\.\(scenario\.tags\.includes\('@native'\) \? 'native' : 'default'\)/,
    );
  });

  it('native mode tách CDP và không đổi cấu hình hybrid toàn cục', () => {
    assert.match(nativeDriverSource, /private nativeScenario = false/);
    assert.match(nativeDriverSource, /this\.cdpDriver\?\.disconnect\(\)/);
    assert.match(nativeDriverSource, /if \(this\.nativeScenario\) \{/);
    assert.doesNotMatch(source, /hybrid\s*=\s*false/);
  });

  it('fixture native dùng lệnh Appium có kiểu rõ, không nhận mobile command tuỳ ý', () => {
    assert.match(nativeDriverSource, /execute\('mobile: fingerprint', \{ fingerprintId: 1 \}\)/);
    assert.match(nativeDriverSource, /execute\('mobile: sendBiometricMatch'/);
    assert.match(nativeDriverSource, /execute\('mobile: injectEmulatorCameraImage'/);
    assert.doesNotMatch(nativeDriverSource, /runNativeFixture\([^)]*command/);
  });
});
