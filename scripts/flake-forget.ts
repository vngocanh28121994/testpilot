/**
 * Drops a scenario's flake history.
 *
 * The detector is deliberately slow to forgive: two failures inside a 30-run
 * window keep a scenario quarantined until enough passes dilute them below the
 * threshold. That is right when the failures were real flakiness, and wrong
 * when they were caused by a misconfiguration you have since fixed — there the
 * history describes the old setup, not the test.
 *
 *   npx tsx scripts/flake-forget.ts --list
 *   npx tsx scripts/flake-forget.ts dang-nhap-thanh-cong
 *   npx tsx scripts/flake-forget.ts --all
 *
 * Matching is a case-insensitive substring of the key, so a scenario name
 * fragment is enough.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

interface Entry {
  outcomes: string[];
  lastSeen?: string;
  quarantinedSince?: string;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Dùng: flake-forget.ts <phần tên scenario> | --all | --list');
    process.exit(2);
  }

  const cfg = await loadConfig();
  const file = path.resolve(cfg.paths.flakeDb);
  if (!existsSync(file)) {
    console.log(`Chưa có lịch sử flake ở ${file}.`);
    return;
  }

  const db = JSON.parse(await readFile(file, 'utf8')) as {
    version: number;
    window: number;
    scenarios: Record<string, Entry>;
  };
  const keys = Object.keys(db.scenarios);

  if (arg === '--list') {
    for (const k of keys) {
      const e = db.scenarios[k]!;
      const fails = e.outcomes.filter((o) => o !== 'p').length;
      const rate = e.outcomes.length ? Math.round((fails / e.outcomes.length) * 100) : 0;
      const held = e.quarantinedSince ? '  [đang cách ly]' : '';
      console.log(`  ${rate}% (${fails}/${e.outcomes.length})${held}  ${k}`);
    }
    if (keys.length === 0) console.log('  (trống)');
    return;
  }

  const target =
    arg === '--all' ? keys : keys.filter((k) => k.toLowerCase().includes(arg.toLowerCase()));

  if (target.length === 0) {
    console.error(`Không có scenario nào khớp "${arg}". Dùng --list để xem danh sách.`);
    process.exit(1);
  }

  for (const k of target) {
    delete db.scenarios[k];
    console.log(`  đã xoá lịch sử: ${k}`);
  }
  await writeFile(file, JSON.stringify(db, null, 2) + '\n', 'utf8');
  console.log(`\n${target.length} scenario sẽ được đánh giá lại từ đầu ở lượt chạy tới.`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
