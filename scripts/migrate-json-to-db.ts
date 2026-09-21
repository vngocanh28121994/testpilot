/**
 * Đưa dữ liệu từ các file JSON vào Postgres.
 *
 *   npx tsx scripts/migrate-json-to-db.ts              # chỉ xem, không ghi
 *   npx tsx scripts/migrate-json-to-db.ts --apply      # ghi thật
 *
 * **Mặc định là KHÔNG ghi.** Một script di trú chạy nhầm trên đúng cơ sở dữ
 * liệu thật là loại nhầm không hoàn tác được bằng Ctrl-Z, nên nó phải đòi
 * người dùng nói ra ý định. Bản xem trước in đúng những gì bản ghi sẽ làm.
 *
 * Chạy lại nhiều lần là an toàn: registry ghi theo (org, kind, key) nên lần
 * sau cập nhật đúng dòng ấy; job ghi theo id nên lần sau cập nhật đúng job ấy.
 * Điều đó quan trọng vì một lần di trú thật hiếm khi xong trong một lần chạy —
 * người ta chạy thử, sửa, rồi chạy lại.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { History } from '../src/core/history.js';
import { listRuns } from '../src/core/runstore.js';
import type { ElementRegistry } from '../src/core/types.js';
import { connect, dbOptionsFromEnv } from '../src/server/db/connect.js';
import { revisionOf } from '../src/server/db/repo.js';

const APPLY = process.argv.includes('--apply');
const ORG = process.env.TESTPILOT_ORG_ID?.trim() || 'default';
const OWNER_EMAIL = process.env.TESTPILOT_MIGRATION_OWNER?.trim() || 'migration@testpilot.local';

function say(line: string): void {
  console.log(`${APPLY ? '[ghi]  ' : '[xem]  '}${line}`);
}

async function main(): Promise<void> {
  const db = dbOptionsFromEnv();
  if (!db) {
    console.error(
      'Thiếu TESTPILOT_DATABASE_URL. Xem .env.server.example, và `docker compose up -d` '
      + 'để có Postgres chạy trên máy.',
    );
    process.exit(2);
  }

  const cfg = await loadConfig(process.env.TESTPILOT_CONFIG);
  const pool = await connect(db);
  const at = new Date().toISOString();

  try {
    // ── Tổ chức và người sở hữu ────────────────────────────────────────────
    // Phải có trước mọi thứ khác: `registry_object.org_id` và `job.created_by`
    // đều là khoá ngoại. Ràng buộc ấy đúng — nó chặn dữ liệu mồ côi — nên di
    // trú phải tôn trọng nó thay vì gỡ nó ra cho dễ.
    say(`tổ chức "${ORG}", người sở hữu "${OWNER_EMAIL}"`);
    if (APPLY) {
      await pool.query(
        `INSERT INTO org (id, name, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [ORG, ORG, at],
      );
      await pool.query(
        `INSERT INTO app_user (id, email, name, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        ['migration', OWNER_EMAIL, 'Di trú', at],
      );
      await pool.query(
        `INSERT INTO membership (org_id, user_id, role) VALUES ($1, 'migration', 'admin')
         ON CONFLICT DO NOTHING`,
        [ORG],
      );
    }

    // ── Registry ───────────────────────────────────────────────────────────
    const registryFile = path.resolve(cfg.paths.registry);
    if (existsSync(registryFile)) {
      const body = JSON.parse(await readFile(registryFile, 'utf8')) as ElementRegistry;
      const elements = Object.keys(body.elements ?? {}).length;
      const screens = Object.keys(body.screens ?? {}).length;
      say(`registry: ${elements} element, ${screens} màn hình ← ${cfg.paths.registry}`);
      if (APPLY) {
        await pool.query(
          `INSERT INTO registry_object (org_id, kind, key, revision, body, updated_at)
           VALUES ($1, 'elements', 'default', $2, $3, $4)
           ON CONFLICT (org_id, kind, key)
           DO UPDATE SET revision = EXCLUDED.revision, body = EXCLUDED.body,
                         updated_at = EXCLUDED.updated_at`,
          [ORG, revisionOf(body), body, at],
        );
      }
    } else {
      say(`registry: không có ${cfg.paths.registry}, bỏ qua`);
    }

    // ── Lịch sử workflow ───────────────────────────────────────────────────
    const history = await History.load();
    const runs = history.list();
    say(`lịch sử: ${runs.length} lượt chạy`);
    if (APPLY) {
      for (const run of runs) {
        await pool.query(
          `INSERT INTO job (id, org_id, created_by, kind, state, priority, requested_at,
                            finished_at, payload, attempt)
           VALUES ($1, $2, 'migration', $3, $4, 0, $5, $6, $7, 1)
           ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state,
                                          finished_at = EXCLUDED.finished_at,
                                          payload = EXCLUDED.payload`,
          [
            run.id, ORG,
            run.kind === 'workflow' ? 'workflow' : 'run_suite',
            run.status === 'passed' ? 'succeeded'
              : run.status === 'failed' ? 'failed'
              : run.status === 'running' ? 'running' : 'queued',
            run.startedAt, run.finishedAt ?? null, run,
          ],
        );
      }
    }

    // ── Lượt chạy local ────────────────────────────────────────────────────
    // Chỉ ĐẾM, không chuyển. `RunMeta` mô tả một thư mục trên đĩa của máy chạy
    // test, và ở chế độ server thư mục ấy không nằm trên server. Chúng đi lên
    // cùng artifact khi runner đẩy kết quả (P2.5) — di trú chúng lúc này sẽ
    // tạo ra những bản ghi trỏ vào các đường dẫn không tồn tại ở đó.
    const local = await listRuns(cfg.paths.runs);
    say(`lượt chạy local: ${local.length} thư mục — KHÔNG di trú (xem chú thích trong script)`);

    // ── Đối chiếu sau khi ghi ──────────────────────────────────────────────
    if (APPLY) {
      const { rows } = await pool.query<{ elements: string; jobs: string }>(
        `SELECT
           (SELECT count(*) FROM registry_object WHERE org_id = $1) AS elements,
           (SELECT count(*) FROM job WHERE org_id = $1) AS jobs`,
        [ORG],
      );
      console.log(
        `\n✓ Trong DB sau khi ghi: ${rows[0]?.elements} bản ghi registry, ${rows[0]?.jobs} job.`,
      );
    } else {
      console.log('\nChưa ghi gì. Thêm --apply để thực hiện.');
    }
  } finally {
    await pool.end();
  }
}

await main();
