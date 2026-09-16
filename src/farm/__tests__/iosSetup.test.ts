import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const testSpec = readFileSync('farm/testspec.yml', 'utf8');
const testSpecCommands = testSpec.replace(/^\s*#[^\n]*$/gm, '');
const farmSource = readFileSync('src/farm/devicefarm.ts', 'utf8');

describe('AWS Device Farm iOS setup', () => {
  it('uses a current managed host and managed Node/Appium versions', () => {
    assert.match(testSpec, /^ios_test_host: macos_tahoe$/m);
    assert.match(testSpec, /devicefarm-cli use node 22/);
    assert.match(testSpec, /devicefarm-cli use appium 2/);
    assert.doesNotMatch(testSpecCommands, /unofficial-builds\.nodejs\.org|\bavm\b/);
  });

  it('starts XCUITest with Device Farm prebuilt signed WDA', () => {
    assert.match(testSpec, /DEVICEFARM_APPIUM_WDA_DERIVED_DATA_PATH_V/);
    assert.match(testSpec, /appium:derivedDataPath/);
    assert.match(testSpec, /appium:usePrebuiltWDA\\?":true/);
    assert.match(testSpec, /appium:automationName\\?":\\?"XCUITest/);
  });

  it('sends run secrets as configuration variables instead of testspec commands', () => {
    const scheduleBlock = farmSource.slice(
      farmSource.indexOf('const environmentVariables ='),
      farmSource.indexOf('const run = await client.send'),
    );
    assert.match(scheduleBlock, /configuration:\s*\{/);
    assert.match(scheduleBlock, /environmentVariables/);
    assert.doesNotMatch(testSpec, /export TESTPILOT_(?:USERNAME|PASSWORD)_/);
    assert.doesNotMatch(farmSource, /function renderTestSpec|function shellQuote/);
  });
});
