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
import { readFileSync, readdirSync } from 'node:fs';
import { allRoutes } from '../index.js';
import { mergeTables } from '../types.js';

const server = readFileSync('src/ui/server.ts', 'utf8');
/**
 * Đọc từ `index.ts`, không tự gộp lại danh sách.
 *
 * Bản đầu của test này tự gộp ba bảng nó biết, và khi ba nhóm route nữa được
 * chuyển thì nó báo "tổng route hụt 5" — đỏ vì một lý do không có thật. Một
 * danh sách chép ở hai nơi thì sớm muộn cũng lệch.
 */
const moved = allRoutes;

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

/**
 * Một handler rỗng là route CHẾT: request treo cho tới khi client bỏ cuộc.
 *
 * Xảy ra thật ngày 2026-09-21 khi tách nhóm 4/7. Kịch bản `case 'X':` một dòng
 * bị cắt sai: dòng `return json(...)` ở lại chỗ cũ rồi bị dọn cùng đám mồ côi,
 * và handler mới ra đời với thân rỗng. `npm test` xanh, `typecheck` xanh —
 * TypeScript không có gì để phàn nàn về một hàm async không trả lời — và
 * `GET /api/builds` treo 120 giây khi gọi thật.
 *
 * Kiểu hỏng này im lặng theo đúng nghĩa xấu nhất: không lỗi, không log, không
 * 500. Chỉ một cái quay vòng mãi trên giao diện.
 */
describe('không handler nào rỗng', () => {
  it('mọi handler trong routes/ đều có thân', () => {
    const files = readdirSync('src/server/routes').filter((f) => f.endsWith('.ts'));
    const empty: string[] = [];
    for (const file of files) {
      const text = readFileSync(`src/server/routes/${file}`, 'utf8');
      for (const m of text.matchAll(/^ {2}'([A-Z]+ [^']+)': [^\n]*=> \{\s*\n\s*\},/gm)) {
        empty.push(`${file} → ${m[1]}`);
      }
    }
    assert.deepEqual(empty, [], `handler rỗng: ${empty.join(', ')}`);
  });

  /** Và mỗi handler phải thực sự trả lời: `json`, `stream`, hoặc tự ghi vào res. */
  it('mọi handler đều gọi một đường trả lời', () => {
    const files = readdirSync('src/server/routes').filter((f) => f.endsWith('.ts'));
    const silent: string[] = [];
    for (const file of files) {
      const text = readFileSync(`src/server/routes/${file}`, 'utf8');
      for (const m of text.matchAll(/^ {2}'([A-Z]+ [^']+)': [^\n]*=> \{\n([\s\S]*?)^ {2}\},/gm)) {
        const body = m[2]!;
        if (!/\bjson\(|\bstream\(|res\.(end|writeHead)/.test(body)) silent.push(`${file} → ${m[1]}`);
      }
    }
    assert.deepEqual(silent, [], `handler không trả lời gì: ${silent.join(', ')}`);
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
