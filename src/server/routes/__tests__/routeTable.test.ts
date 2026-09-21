/**
 * Một route phải nằm ở ĐÚNG MỘT chỗ.
 *
 * Trong lúc P1.2 chuyển route dần, `handle()` tra bảng trước rồi mới rơi vào
 * `switch` cũ. Hai chỗ so khớp cùng lúc là tạm thời, và nó có một kiểu hỏng
 * riêng: một route chuyển sang bảng nhưng `case` cũ chưa bị xoá. Lúc ấy bản
 * trong bảng luôn thắng, `case` kia thành code chết — và nếu ai đó sửa nhầm
 * vào `case` chết ấy thì sửa xong sẽ thấy "không có tác dụng gì", một buổi
 * chiều đi tìm nguyên nhân.
 *
 * Bài test này đọc mã nguồn `server.ts` dạng chuỗi. Không import được: file ấy
 * khởi động server thật ngay khi được nạp.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogRoutes } from '../catalog.js';
import { configRoutes } from '../config.js';
import { historyRoutes } from '../history.js';
import { mergeTables } from '../types.js';

const server = readFileSync('src/ui/server.ts', 'utf8');
const moved = mergeTables(catalogRoutes, configRoutes, historyRoutes);

/** Các route còn nằm trong `switch`. */
function switchRoutes(): string[] {
  return [...server.matchAll(/^ {4}case '([^']+)':/gm)].map((m) => m[1]!);
}

describe('bảng route và switch không chồng nhau', () => {
  it('route đã chuyển thì không còn case trong server.ts', () => {
    const still = Object.keys(moved).filter((route) => switchRoutes().includes(route));
    assert.deepEqual(
      still,
      [],
      `route vừa ở bảng vừa ở switch: ${still.join(', ')}. `
        + 'Bản trong bảng luôn thắng, nên case kia là code chết.',
    );
  });

  it('không có route nào khai báo hai lần trong switch', () => {
    const routes = switchRoutes();
    const dup = routes.filter((route, i) => routes.indexOf(route) !== i);
    assert.deepEqual(dup, [], `case trùng trong switch: ${dup.join(', ')}`);
  });

  /**
   * Tổng số route không được đổi ngoài ý muốn trong lúc chuyển. Thêm hoặc bỏ
   * route là việc hợp lệ — nhưng khi ấy phải sửa cả FARM-ROUTE-MAP.md, vì đó
   * là danh sách việc của P1.
   */
  it('tổng số route vẫn là 52', () => {
    const total = switchRoutes().length + Object.keys(moved).length;
    assert.equal(
      total,
      52,
      `Tổng route đổi thành ${total}. Nếu cố ý thêm/bỏ route thì cập nhật `
        + 'FARM-ROUTE-MAP.md rồi sửa con số này.',
    );
  });

  it('handle() tra bảng trước khi vào switch', () => {
    const at = server.indexOf('const moved = ROUTES[route];');
    assert.ok(at > 0, 'không thấy chỗ tra bảng route');
    assert.ok(at < server.indexOf('switch (route) {'), 'phải tra bảng TRƯỚC switch');
  });
});

describe('mergeTables', () => {
  /** Trùng khoá trong object literal là lỗi im lặng: bản sau thắng, không ai biết. */
  it('ném khi hai bảng cùng khai báo một route', () => {
    const a = { 'GET /x': () => {} };
    const b = { 'GET /x': () => {} };
    assert.throws(() => mergeTables(a, b), /khai báo hai lần: GET \/x/);
  });

  it('gộp được các bảng rời nhau', () => {
    const merged = mergeTables({ 'GET /x': () => {} }, { 'POST /y': () => {} });
    assert.deepEqual(Object.keys(merged).sort(), ['GET /x', 'POST /y']);
  });
});
