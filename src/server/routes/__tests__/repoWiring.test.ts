/**
 * Handler đọc/ghi dữ liệu dùng chung phải đi qua `ctx.repos`.
 *
 * Kiểu hỏng cần chặn im lặng và nguy hiểm: một handler gọi thẳng
 * `Registry.load(cfg.paths.registry)` vẫn chạy đúng ở chế độ embedded — nó đọc
 * file trên đĩa, và ở đó file ấy đúng là dữ liệu của người dùng. Ở chế độ
 * server thì cũng vẫn chạy: nó đọc file trên đĩa SERVER, kể cả khi đang phục
 * vụ một tổ chức khác. Không lỗi, không log, chỉ dữ liệu sai người.
 *
 * Bài test này đo theo từng file, không đo toàn bộ một lượt: các route còn lại
 * chuyển dần, và một danh sách "đã chuyển" nói rõ tiến độ hơn một con số.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Mã nguồn không kèm chú thích.
 *
 * Cần thiết, không phải kỹ càng quá: bản đầu của bài test này đọc cả chú
 * thích, nên một dòng giải thích "phép gộp sẽ gọi `repos.registry.merge()` ở
 * P4.4" làm nó báo đỏ đúng cái file mà nó vừa khẳng định là không dùng repo.
 * Một phép đo đọc cả lời giải thích thì không đo code nữa.
 */
function codeOnly(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** File đã chuyển xong — thêm dần khi chuyển tiếp, không bao giờ bớt đi. */
const CONVERTED = ['healing.ts', 'state.ts', 'catalog.ts', 'feature.ts'];

/**
 * File KHÔNG đọc registry ở tầng route, và lý do phải nói ra.
 *
 * `workflow.ts` ghi registry — nhưng ghi ở TIẾN TRÌNH CON, qua đường dẫn file,
 * sau khi từng nhánh nền tảng chạy xong. Ở chế độ server những thư mục ấy nằm
 * trên máy runner chứ không trên server, nên đường đúng không phải "đổi hàm
 * sang repo" mà là "runner gửi delta lên qua JobResult" (P4.4). Liệt kê ở đây
 * để không ai nhìn danh sách CONVERTED rồi tưởng nó bị bỏ quên.
 */
const NOT_ROUTE_LEVEL = ['workflow.ts'];

describe('route dùng kho dữ liệu qua ctx.repos', () => {
  for (const file of CONVERTED) {
    it(`${file} không còn tự đọc registry từ đĩa`, () => {
      const source = readFileSync(`src/server/routes/${file}`, 'utf8');
      // `(?<!Action)` là phần quan trọng: `ActionRegistry` là một store KHÁC
      // (macro hành động, `actions.json`), và nó chưa có repo riêng. Thiếu chỗ
      // loại trừ ấy thì bài test báo đỏ một file đã chuyển xong — một phép đo
      // sai theo hướng ồn ào, kiểu làm người ta học cách bỏ qua nó.
      assert.doesNotMatch(
        source,
        /(?<!Action)Registry\.load\(/,
        `${file} vẫn gọi Registry.load() — ở chế độ server nó đọc đĩa của server, `
          + 'không đọc dữ liệu của tổ chức người gọi.',
      );
      // `repos.registry` chứ không `ctx.repos.registry`: một số file nhận
      // `repos` làm tham số của hàm rồi truyền xuống (như `state()`), và cách
      // luồn dây ấy không đổi điều đang được canh — dữ liệu đi qua kho, không
      // đi qua đĩa.
      assert.match(source, /repos\.registry/, `${file} phải đọc qua repos.registry`);
    });

    /**
     * Ghi mà không kèm phiên bản là ghi đè người khác trong im lặng — đúng thứ
     * `RevisionConflictError` sinh ra để chấm dứt.
     *
     * File chỉ đọc thì không có gì để kiểm ở đây, và điều đó tự nó là một tính
     * chất đáng giữ: `state.ts` và `catalog.ts` KHÔNG được ghi registry.
     */
    it(`${file} ghi registry kèm phiên bản và trả 409 khi lệch`, () => {
      const source = codeOnly(`src/server/routes/${file}`);
      const writes = [...source.matchAll(/repos\.registry\.write\(([^)]*)\)/g)];
      if (writes.length === 0) return;
      for (const write of writes) {
        // Tên biến nào cũng được, miễn là NÓ CÓ: `feature.ts` gọi nó
        // `registryRevision` để không lẫn với `revision` của nội dung feature
        // — hai phiên bản khác nhau trong cùng một handler.
        assert.match(
          write[1] ?? '',
          /,\s*\w*[Rr]evision/,
          `một lệnh ghi trong ${file} thiếu baseRevision: ${write[0]}`,
        );
      }
      assert.match(source, /RevisionConflictError/, `${file} phải dịch xung đột thành 409`);
      assert.match(source, /409/);
    });
  }
});

describe('file ghi registry ở tầng khác', () => {
  for (const file of NOT_ROUTE_LEVEL) {
    it(`${file} không đọc registry ở tầng route`, () => {
      const source = codeOnly(`src/server/routes/${file}`);
      assert.doesNotMatch(source, /(?<!Action)Registry\.load\(/);
      assert.doesNotMatch(source, /repos\.registry/);
    });

    /** Và phải nói ra chỗ ghi thật nằm ở đâu, kèm giai đoạn sẽ chuyển. */
    it(`${file} ghi rõ phép gộp thuộc về runner`, () => {
      const source = readFileSync(`src/server/routes/${file}`, 'utf8');
      assert.match(source, /P4\.4/);
      assert.match(source, /registryProposal/);
    });
  }
});

describe('bối cảnh route', () => {
  it('RouteContext mang repos, không mang đường dẫn file', () => {
    const types = readFileSync('src/server/routes/types.ts', 'utf8');
    assert.match(types, /repos: Repos;/);
  });

  /**
   * Kho phải bị giới hạn theo tổ chức NGAY TỪ LÚC DỰNG, không nhờ mỗi truy vấn
   * nhớ thêm điều kiện. Một truy vấn quên `WHERE org_id` thì không ai thấy, và
   * thứ nó trả về là dữ liệu của người khác.
   */
  it('dispatch dựng kho theo danh tính người gọi', () => {
    const dispatcher = readFileSync('src/server/dispatch.ts', 'utf8');
    assert.match(dispatcher, /repos: \(identity: Identity\) => Repos \| Promise<Repos>/);
    assert.match(dispatcher, /repos: await deps\.repos\(decision\.identity\)/);
  });
});
