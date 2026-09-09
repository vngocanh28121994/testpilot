/**
 * Repo không được chứa symlink.
 *
 * Một symlink trỏ vào chính nó từng nằm trong index dưới tên `node_modules`,
 * `ui/node_modules` và `build`. Mỗi lần git dựng lại working tree, nó ghi đè
 * symlink đó lên thư mục thật — xoá sạch dependencies đã cài và cả file
 * build/App.ipa 108 MB. Không có gì cảnh báo, và triệu chứng ("tsx: not found")
 * không chỉ về nguyên nhân.
 *
 * Nguồn gốc là một mẫu .gitignore có dấu `/` ở cuối: `node_modules/` chỉ khớp
 * THƯ MỤC, nên trong worktree — nơi node_modules là symlink — `git add -A` nuốt
 * gọn cái symlink. Vì thế test này canh cả hai đầu: không symlink trong index,
 * và mẫu ignore phải viết không có dấu / ở cuối.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('vệ sinh repo', () => {
  it('không có symlink nào được theo dõi', () => {
    const tracked = execFileSync('git', ['ls-files', '-s'], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => line.startsWith('120000'))
      .map((line) => line.split('\t')[1]);
    assert.deepEqual(tracked, [], `symlink trong index: ${tracked.join(', ')}`);
  });

  it('bỏ qua node_modules và build kể cả khi chúng là symlink', () => {
    const ignore = readFileSync('.gitignore', 'utf8').split('\n');
    for (const name of ['node_modules', 'build']) {
      assert.ok(ignore.includes(name), `.gitignore phải có dòng "${name}" (không dấu /)`);
      assert.ok(!ignore.includes(`${name}/`), `"${name}/" không khớp symlink — bỏ dấu /`);
    }
  });

  // Gỡ khỏi index là chưa đủ: bản đã bị git dựng ra vẫn nằm trên đĩa, và cái
  // ELOOP đầu tiên người dùng gặp lại là lúc tải bản build lên — mkdir 'build'
  // hỏng, còn thông báo thì không nói gì về symlink.
  it('không còn symlink tự trỏ nào trên đĩa', () => {
    const loops: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 3) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
          if (path.resolve(dir, readlinkSync(full)) === path.resolve(full)) loops.push(full);
          continue;
        }
        // Chỉ đi vào thư mục thật; theo symlink là cách tự đi vào vòng lặp.
        if (lstatSync(full).isDirectory()) walk(full, depth + 1);
      }
    };
    walk(process.cwd(), 0);
    assert.deepEqual(loops, [], `symlink trỏ vào chính nó: ${loops.join(', ')}`);
  });
});
