/**
 * Mọi thứ trong `registry/` phải được phân loại, và phân loại phải đúng.
 *
 * Kiểu hỏng cần chặn không phải là một dòng code sai, mà là một file mới lặng
 * lẽ xuất hiện. Ai đó thêm `registry/abc.json` trong lúc làm việc khác, không
 * nghĩ tới chuyện nhiều máy, và sáu tháng sau đường đồng bộ hoặc bỏ sót nó
 * (dữ liệu của cả đội chỉ có trên một máy) hoặc đẩy nó đi (cache của một chiếc
 * điện thoại áp cho mọi máy). Cả hai đều im lặng.
 *
 * Nên: file nào có trong thư mục mà chưa khai báo thì test này đỏ, và người
 * thêm file phải trả lời đúng một câu — cái này thuộc về ai.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ConfigSchema } from '../../config.js';
import { STORES, deviceStores, sharedStores, storeById, storePath } from '../stores.js';

const REGISTRY_DIR = 'registry';

/** Bản sao lưu và tệp tạm không phải store; chúng không được đồng bộ đi đâu cả. */
function isTransient(name: string): boolean {
  return /\.bak(-|$)|\.tmp$|^\./.test(name);
}

describe('phân loại store trong registry/', () => {
  it('mỗi store khai báo đủ scope, shape và lý do', () => {
    for (const store of STORES) {
      assert.ok(store.id, 'store thiếu id');
      assert.match(store.scope, /^(shared|device|derived)$/, `${store.id}: scope lạ`);
      assert.match(store.shape, /^(document|event-log|counters)$/, `${store.id}: shape lạ`);
      assert.ok(
        store.note.length > 30,
        `${store.id}: thiếu lý do. Một phân loại không giải thích được là một phỏng đoán.`,
      );
    }
  });

  it('id không trùng nhau', () => {
    const ids = STORES.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, 'có id store bị lặp');
  });

  /** Khoá trỏ vào `config.paths` phải tồn tại thật, nếu không store đọc phải chuỗi rỗng. */
  it('mọi khoá path đều có trong schema config', () => {
    const paths = ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } }).paths as
      Record<string, string>;
    for (const store of STORES) {
      if ('fixed' in store.path) continue;
      assert.ok(
        store.path.key in paths,
        `${store.id}: config.paths không có khoá "${store.path.key}"`,
      );
      assert.ok(storePath(store, paths), `${store.id}: storePath() trả về rỗng`);
    }
  });

  /**
   * Thư mục thật là nguồn sự thật, không phải danh sách trong code. Một file
   * chưa khai báo phải làm test đỏ ngay lần chạy đầu sau khi nó xuất hiện.
   */
  it('không có file nào trong registry/ mà chưa được khai báo', () => {
    if (!existsSync(REGISTRY_DIR)) return; // Checkout sạch chưa chạy lần nào.
    const paths = ConfigSchema.parse({ web: { baseUrl: 'https://example.com' } }).paths as
      Record<string, string>;
    const declared = new Set(
      STORES.map((store) => path.basename(storePath(store, paths))),
    );

    const undeclared = readdirSync(REGISTRY_DIR)
      .filter((name) => !isTransient(name))
      .filter((name) => !declared.has(name));

    assert.deepEqual(
      undeclared,
      [],
      `registry/ có thứ chưa khai báo: ${undeclared.join(', ')}. `
        + 'Thêm vào src/core/stores.ts và nói rõ nó thuộc về cả đội hay thuộc về một chiếc máy.',
    );
  });

  /**
   * Hai store này là cache của một chiếc máy cụ thể. Chúng đi lên chỗ dùng
   * chung là đem sự thật của một thiết bị áp cho thiết bị khác — và kiểu sai
   * ấy không báo lỗi, nó chỉ làm locator hỏng ở nơi khác.
   */
  it('danh sách device-scope là đúng hai store, không hơn', () => {
    assert.deepEqual(
      deviceStores().map((s) => s.id).sort(),
      ['device-env', 'runtime-registry'],
    );
  });

  it('không store device nào lọt vào danh sách đồng bộ', () => {
    const shared = new Set(sharedStores().map((s) => s.id));
    for (const store of deviceStores()) {
      assert.equal(shared.has(store.id), false, `${store.id} vừa device vừa shared`);
    }
  });

  /**
   * Hai sổ này bị ghi đè cả tệp ở bản hôm nay. Khai báo `shape` là bước đầu để
   * P2.4b đổi chúng sang append/cộng dồn — và để không ai vô tình đổi ngược lại.
   */
  it('healing là sổ sự kiện, flake là số cộng dồn', () => {
    assert.equal(storeById('healing')?.shape, 'event-log');
    assert.equal(storeById('flake')?.shape, 'counters');
  });
});
