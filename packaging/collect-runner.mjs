/**
 * Gom đúng phần `dist/` mà runner chạm tới, và đúng phần phụ thuộc nó import.
 *
 * Đi theo đồ thị import từ `dist/runner/main.js`. File nội bộ (`./`, `../`)
 * được chép sang gói; specifier trần được gom thành tên gói npm và đối chiếu
 * với `dependencies` của repo.
 *
 * Vì sao phải đo thay vì liệt kê tay: danh sách viết tay lệch dần theo mỗi lần
 * ai đó thêm một `import`, và triệu chứng là một chiếc máy ở xa chết lúc khởi
 * động vì thiếu một module mà không ai nghĩ tới. Đồ thị import thì không lệch
 * được — nó ĐƯỢC SINH RA từ chính mã sắp phát hành.
 *
 * `import()` động với chuỗi ghép thì đồ thị này không thấy. Hôm nay runner
 * không có cái nào; nếu có, nó phải được khai ở `EXTRA` bên dưới.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Thứ chỉ xuất hiện trong `import()` động, nếu có. Hôm nay: không có. */
const EXTRA = [];

/**
 * Điểm vào — số nhiều, và đó là điểm dễ bỏ sót nhất ở đây.
 *
 * `main.js` không `import` hai CLI chạy test; nó SINH TIẾN TRÌNH cho chúng
 * (xem `cliCommand()` trong runner/execute.ts). Đồ thị import không thấy được
 * một lời gọi `spawn`, nên chỉ lấy `main.js` làm gốc thì gói phát hành thiếu
 * đúng phần chạy test — và nó cài được, khởi động được, nhận job được, rồi
 * hỏng ở lượt chạy đầu tiên bằng ENOENT.
 */
const ROOTS = [
  'runner/main.js', 'cli/runner-login.js', 'cli/run.js', 'cli/run-parallel.js',
];

const out = process.argv[2] ?? 'dist-runner';
const root = process.cwd();
const dist = path.join(root, 'dist');
const entries = ROOTS.map((rel) => path.join(dist, rel));
const absent = entries.filter((file) => !fs.existsSync(file));
if (absent.length > 0) {
  console.error(`Chưa có ${absent.join(', ')}. Chạy \`npm run build\` trước.`);
  process.exit(1);
}

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

const files = new Set();
const packages = new Set(EXTRA);
const queue = [...entries];

while (queue.length > 0) {
  const file = queue.pop();
  if (files.has(file)) continue;
  files.add(file);

  // Bỏ bình luận trước khi dò: một câu như `Distinct from 'verified'` trong
  // chú thích khớp y hệt một lời import thật, và gói "verified" thì không tồn tại.
  const source = codeOnly(fs.readFileSync(file, 'utf8'));
  for (const [, specifier] of source.matchAll(IMPORT)) {
    if (specifier.startsWith('node:')) continue;
    // Chuỗi trong mã SINH mã trông giống hệt một lời import: `pom.js` viết ra
    // các file page-object, và những đường dẫn nó viết ra là dữ liệu của nó,
    // không phải phụ thuộc của nó. Lọc theo hình dạng: một specifier thật
    // không có khoảng trắng, không có `${}`, không có dấu ngoặc nhọn.
    if (!/^[@\w./-]+$/.test(specifier)) continue;
    if (specifier.startsWith('.')) {
      const resolved = resolveLocal(path.dirname(file), specifier);
      if (resolved) queue.push(resolved);
      continue;
    }
    packages.add(packageOf(specifier));
  }
}

function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
function packageOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function resolveLocal(from, specifier) {
  for (const candidate of [
    path.resolve(from, specifier),
    path.resolve(from, `${specifier}.js`),
    path.resolve(from, specifier, 'index.js'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  // Một import không phân giải được là một file sẽ THIẾU lúc chạy. Nói ra chứ
  // đừng bỏ qua: đây đúng là kiểu hỏng chỉ lộ ra trên máy người khác.
  //
  // Có một nguồn báo nhầm đã biết: mã SINH mã mang cả câu `import ... from
  // '...'` bên trong một chuỗi (pom/generator.js kiểm xem file nó viết ra đã
  // có dòng ấy chưa). Bỏ bình luận không gỡ được chuỗi, nên câu dưới đây nói
  // rõ cả hai khả năng thay vì báo động một chiều.
  console.error(
    `⚠ không phân giải được "${specifier}" từ ${path.relative(root, from)} `
    + '(nếu nó nằm trong một chuỗi của mã sinh mã thì bỏ qua được)',
  );
  return undefined;
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dependencies = {};
const missing = [];
for (const name of [...packages].sort()) {
  const range = manifest.dependencies?.[name];
  if (range) dependencies[name] = range;
  else missing.push(name);
}
if (missing.length > 0) {
  console.error(`⚠ import gói không có trong dependencies: ${missing.join(', ')}`);
}

for (const file of files) {
  const target = path.join(out, path.relative(root, file));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}

fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify({
    name: process.env.TESTPILOT_RUNNER_PACKAGE || '@noi-bo/testpilot-runner',
    version: manifest.version,
    description: 'Runner TestPilot: nhận job từ control plane và chạy test trên máy này.',
    type: 'module',
    bin: {
      'testpilot-runner': 'dist/runner/main.js',
      'testpilot-runner-login': 'dist/cli/runner-login.js',
    },
    files: ['dist'],
    engines: manifest.engines,
    dependencies,
  }, null, 2) + '\n',
);

console.log(
  `${files.size} file, ${Object.keys(dependencies).length} phụ thuộc: `
  + Object.keys(dependencies).join(', '),
);
