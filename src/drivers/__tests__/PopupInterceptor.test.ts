import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { PopupInterceptor } from '../PopupInterceptor.js';

describe('PopupInterceptor', () => {
  it('clears semantic popup layers from top to bottom', async () => {
    const results = [
      { root: 'mat-dialog-container', control: 'CLOSE', source: 'semantic' as const },
      { root: 'dialog', control: 'BỎ QUA', source: 'semantic' as const },
      null,
    ];
    const messages: string[] = [];
    const page = {
      evaluate: async () => results.shift() ?? null,
      waitForTimeout: async () => {},
      locator: () => { throw new Error('configured fallback should not run'); },
    } as unknown as Page;

    const interceptor = new PopupInterceptor([], (message) => messages.push(message));
    assert.equal(await interceptor.clear(page), 2);
    assert.equal(messages.length, 2);
  });

  it('uses a configured fallback only when its close control is topmost', async () => {
    let clicked = false;
    let evaluated = 0;
    const dismiss = {
      isVisible: async () => true,
      click: async (opts: { trial?: boolean }) => {
        if (!opts.trial) clicked = true;
      },
    };
    const page = {
      evaluate: async () => {
        evaluated += 1;
        return null;
      },
      locator: (selector: string) => ({
        first: () => selector === '.popup'
          ? { isVisible: async () => true }
          : dismiss,
      }),
    } as unknown as Page;

    const interceptor = new PopupInterceptor([
      { detect: '.popup', dismiss: '.popup .close' },
    ], () => {});
    const result = await interceptor.dismissOne(page);
    assert.equal(result?.source, 'configured');
    assert.equal(clicked, true);
    // The next action must not immediately perform the expensive semantic DOM
    // scan after this precise rule already closed the known popup.
    assert.equal(await interceptor.dismissOne(page, ['text=another action target']), null);
    assert.equal(evaluated, 0);
  });

  it('does not click a configured control covered by another layer', async () => {
    let clicked = false;
    const page = {
      evaluate: async () => null,
      locator: (selector: string) => ({
        first: () => selector === '.popup'
          ? { isVisible: async () => true }
          : {
              isVisible: async () => true,
              click: async (opts: { trial?: boolean }) => {
                if (opts.trial) throw new Error('covered');
                clicked = true;
              },
            },
      }),
    } as unknown as Page;

    const interceptor = new PopupInterceptor([
      { detect: '.popup', dismiss: '.popup .close' },
    ], () => {});
    assert.equal(await interceptor.dismissOne(page), null);
    assert.equal(clicked, false);
  });

  it('caches a negative scan but allows an actionability failure to force recheck', async () => {
    let evaluations = 0;
    const page = {
      evaluate: async () => {
        evaluations += 1;
        return null;
      },
    } as unknown as Page;
    const interceptor = new PopupInterceptor([], () => {});

    assert.equal(await interceptor.dismissOne(page), null);
    assert.equal(await interceptor.dismissOne(page), null);
    assert.equal(evaluations, 1);

    assert.equal(await interceptor.dismissOne(page, [], { force: true }), null);
    assert.equal(evaluations, 2);
  });
});

/**
 * Một hộp thoại đóng mãi không chịu đi.
 *
 * Lượt chạy thật ghi 77 dòng "closed top #mat-dialog-1 via CLOSE" cho đúng một
 * hộp thoại Bộ lọc — cùng nút, cùng nội dung. Mỗi lần báo thành công lại xoá bộ
 * nhớ phủ định, nên bộ tắt popup không bao giờ nhận ra nó đang giậm chân, và cả
 * lượt chạy quay vòng tới lúc hết giờ.
 *
 * Lần thứ tư không khác gì lần thứ ba: phải dừng và nói ra, để thứ đang chặn lộ
 * diện thay vì bị che sau một vòng lặp.
 */
describe('PopupInterceptor — hộp thoại không đóng được', () => {
  const luonHien = () => {
    const messages: string[] = [];
    const page = {
      evaluate: async () => ({
        root: '#mat-dialog-1',
        control: 'CLOSE',
        text: 'BỘ LỌC TỪ TCBS CỦA BẠN',
        source: 'semantic' as const,
      }),
      waitForTimeout: async () => {},
      locator: () => { throw new Error('không dùng tới nhánh configured'); },
    } as unknown as Page;
    return { page, messages, interceptor: new PopupInterceptor([], (m) => messages.push(m)) };
  };

  it('thôi đóng sau vài lần cùng một hộp thoại hiện lại', async () => {
    const { page, messages, interceptor } = luonHien();
    const ketQua: unknown[] = [];
    for (let i = 0; i < 10; i += 1) {
      ketQua.push(await interceptor.dismissOne(page, [], { force: true }));
    }
    // Ba lần đầu vẫn thử đóng; từ lần thứ tư thì thôi.
    assert.equal(ketQua.filter(Boolean).length, 3);
    assert.equal(ketQua.slice(3).every((r) => r === null), true);
  });

  it('nói ra đúng một lần, kèm nội dung hộp thoại', async () => {
    const { page, messages, interceptor } = luonHien();
    for (let i = 0; i < 10; i += 1) await interceptor.dismissOne(page, [], { force: true });
    const báo = messages.filter((m) => m.includes('vẫn hiện lại'));
    assert.equal(báo.length, 1, 'chỉ được nói một lần, vì chính việc lặp là thứ đang dập');
    assert.match(báo[0]!, /#mat-dialog-1/);
    assert.match(báo[0]!, /BỘ LỌC TỪ TCBS/);
  });
});
