import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import type { LocatorCandidate } from '../../core/types.js';
import { WebViewCdpDriver, WebViewCdpHandle } from '../WebViewCdpDriver.js';
import { observeDomInPage } from '../domObserve.js';

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => { await browser?.close(); });

describe('WebViewCdpDriver active modal selection', () => {
  it('chooses the duplicate control in the newest dialog', async () => {
    await page.setContent(`
      <div class="cdk-overlay-pane" style="position:fixed;inset:20px;z-index:10">
        <div role="dialog"><button class="btn-add" data-layer="parent">add</button></div>
      </div>
      <div class="cdk-overlay-pane" style="position:fixed;inset:10px;z-index:20">
        <div role="dialog">
          <div class="btn-add" data-layer="decoration">add</div>
          <button class="btn-add" data-layer="child">add</button>
        </div>
      </div>`);

    const driver = new WebViewCdpDriver('test.app');
    (driver as unknown as { page: Page }).page = page;
    const candidate: LocatorCandidate = {
      strategy: 'css',
      value: '.btn-add',
      weight: 1,
      origin: 'authored',
    };

    const handle = await driver.find(candidate);
    assert.ok(handle);
    assert.equal(await handle.locator().getAttribute('data-layer'), 'child');
  });

  it('promotes a custom option caption to its clickable card in the same dialog', async () => {
    await page.setContent(`
      <div role="dialog">
        <button id="picker">Chọn loại nội dung hiển thị</button>
        <div class="cursor-pointer" onclick="document.body.dataset.selected='personal'; this.closest('[role=dialog]').remove()">
          <span>Cá nhân</span>
        </div>
      </div>`);
    const driver = new WebViewCdpDriver('test.app');
    (driver as unknown as { page: Page }).page = page;
    const candidate: LocatorCandidate = {
      strategy: 'css', value: '#picker', weight: 1, origin: 'authored',
    };
    const handle = new WebViewCdpHandle(candidate, page, '#picker');

    await driver.selectOption(handle, 'Cá nhân');

    assert.equal(await page.locator('body').getAttribute('data-selected'), 'personal');
  });

  it('learns an opaque peer-state transfer without knowing component class names', async () => {
    await page.setContent(`
      <div role="dialog">
        <button id="picker">Choose a kind</button>
        <div class="q7"><span class="caption">Personal</span></div>
        <div class="q7 m83"><span class="caption">Business</span></div>
      </div>
      <script>
        for (const choice of document.querySelectorAll('.q7')) {
          choice.addEventListener('click', () => {
            for (const peer of document.querySelectorAll('.q7')) peer.classList.remove('m83');
            choice.classList.add('m83');
          });
        }
      </script>`);
    const driver = new WebViewCdpDriver('test.app');
    (driver as unknown as { page: Page }).page = page;
    const candidate: LocatorCandidate = {
      strategy: 'css', value: '#picker', weight: 1, origin: 'authored',
    };

    await driver.selectOption(new WebViewCdpHandle(candidate, page, '#picker'), 'Personal');

    assert.equal(await page.getByText('Personal', { exact: true }).locator('..').getAttribute('class'), 'q7 m83');
    assert.equal(await page.getByText('Business', { exact: true }).locator('..').getAttribute('class'), 'q7');
  });

  it('recognises replacement state tokens rather than requiring a selected-style suffix', async () => {
    await page.setContent(`
      <div role="dialog">
        <button id="picker">Choose a kind</button>
        <div class="r4 cold"><span>Personal</span></div>
        <div class="r4 hot"><span>Business</span></div>
      </div>
      <script>
        const choices = [...document.querySelectorAll('.r4')];
        for (const choice of choices) choice.addEventListener('click', () => {
          for (const peer of choices) peer.className = peer === choice ? 'r4 hot' : 'r4 cold';
        });
      </script>`);
    const driver = new WebViewCdpDriver('test.app');
    (driver as unknown as { page: Page }).page = page;
    const candidate: LocatorCandidate = {
      strategy: 'css', value: '#picker', weight: 1, origin: 'authored',
    };

    await driver.selectOption(new WebViewCdpHandle(candidate, page, '#picker'), 'Personal');

    assert.equal(await page.getByText('Personal', { exact: true }).locator('..').getAttribute('class'), 'r4 hot');
    assert.equal(await page.getByText('Business', { exact: true }).locator('..').getAttribute('class'), 'r4 cold');
  });

  it('does not confuse focus styling with a successful selection', async () => {
    await page.setContent(`
      <style>.u3:focus { border-color: red; }</style>
      <div role="dialog">
        <button id="picker">Choose a kind</button>
        <div class="u3" tabindex="0"><span>Personal</span></div>
        <div class="u3" tabindex="0"><span>Business</span></div>
      </div>`);
    const driver = new WebViewCdpDriver('test.app');
    (driver as unknown as { page: Page }).page = page;
    const candidate: LocatorCandidate = {
      strategy: 'css', value: '#picker', weight: 1, origin: 'authored',
    };

    await assert.rejects(
      driver.selectOption(new WebViewCdpHandle(candidate, page, '#picker'), 'Personal'),
      /không thấy lựa chọn "Personal" nào bấm được/,
    );
  });

  it('accepts an already selected option only from explicit accessibility state', async () => {
    await page.setContent(`
      <div role="dialog">
        <button id="picker">Choose a kind</button>
        <div class="z2 k91" aria-selected="true" onclick="document.body.dataset.clicked='yes'"><span>Personal</span></div>
        <div class="z2"><span>Business</span></div>
      </div>`);
    const driver = new WebViewCdpDriver('test.app');
    (driver as unknown as { page: Page }).page = page;
    const candidate: LocatorCandidate = {
      strategy: 'css', value: '#picker', weight: 1, origin: 'authored',
    };

    await driver.selectOption(new WebViewCdpHandle(candidate, page, '#picker'), 'Personal');

    assert.equal(await page.locator('body').getAttribute('data-clicked'), null);
  });

  it('does not expose controls behind the front modal as interactive discovery candidates', async () => {
    await page.setContent(`
      <div role="dialog" style="position:fixed;inset:20px;z-index:10">
        <button data-layer="parent">add</button>
      </div>
      <div role="dialog" style="position:fixed;inset:10px;z-index:20">
        <button data-layer="child">add</button>
      </div>`);

    const observed = await page.evaluate(observeDomInPage);
    const addButtons = observed.filter((el) => el.tag === 'button' && el.domText === 'add');
    assert.deepEqual(addButtons.map((el) => el.interactive), [false, true]);
  });
});
