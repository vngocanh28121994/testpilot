/**
 * Cấu hình triển khai: health, Dockerfile, nginx.
 *
 * Ba thứ này không có test tự nhiên nào — chúng chỉ chạy khi triển khai thật,
 * và lúc ấy sai thì phát hiện bằng người dùng. Nên phần được canh ở đây là
 * những dòng mà XOÁ ĐI THÌ VẪN CHẠY, chỉ sai theo cách khó chẩn đoán:
 *
 *  - `proxy_buffering off` — mất nó thì SSE không báo lỗi, log chỉ đơn giản
 *    không hiện hoặc hiện dồn một cục sau hai phút;
 *  - `USER node` — mất nó thì container chạy bằng root và không ai thấy gì;
 *  - `.dockerignore` thiếu `.testpilot.secrets.json` — khoá API nằm trong một
 *    layer Docker là bản copy không ai xoá được nữa.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { healthRoutes } from '../routes/health.js';
import { PUBLIC_ROUTES, requiredRole } from '../auth/policy.js';
import { ANONYMOUS, LOCAL_IDENTITY } from '../auth/roles.js';

const dockerfile = readFileSync('Dockerfile', 'utf8');

/**
 * Dockerfile không kèm chú thích.
 *
 * Lần thứ ba trong dự án này một phép đo đọc mã nguồn bị chính chú thích của
 * mình làm đỏ: dòng "ảnh này KHÔNG có Appium" khớp vào phép kiểm "không kéo
 * Appium vào". Bài học lặp lại đủ ba lần thì đáng thành một dòng code: khi đo
 * mã nguồn, lọc chú thích TRƯỚC, luôn luôn.
 */
const dockerCode = dockerfile.replace(/^\s*#.*$/gm, '');
const dockerignore = readFileSync('.dockerignore', 'utf8');
const nginx = readFileSync('infra/nginx/testpilot.conf', 'utf8');

function fakeRes(): { res: ServerResponse; out: { status?: number; body: string } } {
  const out: { status?: number; body: string } = { body: '' };
  const res = {
    writeHead(status: number) { out.status = status; return this; },
    end(chunk?: unknown) { if (chunk) out.body += String(chunk); },
  } as unknown as ServerResponse;
  return { res, out };
}

const ctx = (identity: typeof ANONYMOUS) => ({
  configFile: 'testpilot.config.json',
  configProfile: { owner: 't', source: 'personal' as const },
  identity,
  repos: {} as never,
});

async function callHealth(query: string, identity = ANONYMOUS) {
  const { res, out } = fakeRes();
  await healthRoutes['GET /api/health']!(
    {} as IncomingMessage, res, new URL(`http://x/api/health${query}`), ctx(identity),
  );
  return out;
}

describe('GET /api/health', () => {
  it('gọi được khi chưa đăng nhập', async () => {
    assert.ok(PUBLIC_ROUTES.has('GET /api/health'), 'health trả 401 nghĩa là mọi instance bị coi là chết');
    assert.ok(requiredRole('GET /api/health'), 'vẫn phải có mặt trong policy');
  });

  it('bản nông trả đúng một chữ, không kể gì thêm', async () => {
    const out = await callHealth('');
    assert.equal(out.status, 200);
    assert.deepEqual(JSON.parse(out.body), { ok: true });
    // Đây là điểm duy nhất người lạ chạm được trước khi đăng nhập. Phiên bản
    // Node và tên máy hữu ích cho người vận hành, và hữu ích y như thế cho
    // người đang dò tìm.
    assert.doesNotMatch(out.body, /node|pid|uptime|mode/i);
  });

  it('bản sâu đòi vai admin', async () => {
    const out = await callHealth('?deep=1', { ...ANONYMOUS, role: 'viewer' });
    assert.equal(out.status, 403);
    assert.match(out.body, /admin/);
  });

  it('admin xem được chi tiết', async () => {
    const out = await callHealth('?deep=1', LOCAL_IDENTITY);
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body) as { ok: boolean; uptimeSeconds: number; node: string };
    assert.equal(body.ok, true);
    assert.ok(Number.isFinite(body.uptimeSeconds));
    assert.match(body.node, /^v\d+/);
  });
});

describe('nginx: những dòng giữ cho SSE sống', () => {
  /** Dòng quan trọng nhất trong cả file. Mất nó thì log không hiện, không lỗi. */
  it('tắt buffering', () => {
    assert.match(nginx, /^\s*proxy_buffering off;/m);
  });

  /** Cùng triệu chứng, tầng khác: tắt buffering rồi vẫn thấy hỏng nếu còn gzip. */
  it('tắt nén', () => {
    assert.match(nginx, /^\s*gzip off;/m);
  });

  /**
   * Một lượt Android dài im lặng vài phút lúc cài app. Timeout mặc định 60
   * giây cắt đường dây giữa lượt, và giao diện coi đó là "đã xong".
   */
  it('timeout đủ dài cho một lượt chạy thật', () => {
    const read = /proxy_read_timeout\s+(\d+)s/.exec(nginx);
    assert.ok(read, 'không đặt proxy_read_timeout');
    assert.ok(Number(read[1]) >= 600, `chỉ ${read[1]}s — một lượt chạy dài hơn thế`);
  });

  /** Upload build là apk/ipa 200-400 MB; mặc định nginx là 1 MB. */
  it('cho phép upload build lớn', () => {
    const size = /client_max_body_size\s+(\d+)m/.exec(nginx);
    assert.ok(size && Number(size[1]) >= 256, 'client_max_body_size quá nhỏ cho một file apk');
  });

  /** Cookie phiên là `Secure`, nên qua HTTP thì không đăng nhập được, không phải "kém an toàn hơn". */
  it('đẩy HTTP sang HTTPS', () => {
    assert.match(nginx, /error_page 497/);
  });
});

describe('Dockerfile của control plane', () => {
  it('không chạy bằng root', () => {
    assert.match(dockerfile, /^USER node$/m);
  });

  /** Ảnh này phục vụ HTTP. Appium/adb/Xcode thuộc về runner, trên máy có thiết bị. */
  it('không kéo công cụ thiết bị vào ảnh server', () => {
    assert.doesNotMatch(dockerCode, /appium|android-sdk|adb|xcode/i);
  });

  it('bỏ devDependencies ở ảnh cuối', () => {
    assert.match(dockerfile, /npm ci --omit=dev/);
  });

  /** Cache theo lớp: sửa một dòng code không được kéo theo cài lại node_modules. */
  it('copy khai báo phụ thuộc trước mã nguồn', () => {
    assert.ok(
      dockerfile.indexOf('COPY package.json') < dockerfile.indexOf('COPY src'),
      'copy src trước package.json làm mọi lần sửa code phải npm ci lại',
    );
  });

  it('có health check, dùng đúng endpoint của load balancer', () => {
    assert.match(dockerfile, /HEALTHCHECK/);
    assert.match(dockerfile, /\/api\/health/);
  });

  /**
   * Lớp cài đặt của ảnh chạy phải bỏ script cài đặt.
   *
   * Đây là một lỗi ĐÃ xảy ra: `prepare` của repo gọi `husky`, husky là
   * devDependency, nên `npm ci --omit=dev` chết với exit 127 và cả lần build
   * thất bại — sau bốn phút chờ. Không có `--ignore-scripts` thì mọi lần thêm
   * một script `prepare`/`postinstall` mới lại làm hỏng ảnh theo cùng cách.
   */
  it('không chạy script cài đặt ở lớp --omit=dev', () => {
    const line = dockerCode.split('\n').find((item) => item.includes('npm ci --omit=dev'));
    assert.ok(line, 'không tìm thấy lớp npm ci --omit=dev');
    assert.match(line, /--ignore-scripts/);
  });

  /**
   * Thứ `CMD` gọi phải là một phụ thuộc lúc chạy.
   *
   * Lỗi thứ hai của cùng lần build ấy, và nó ẩn hơn: `tsx` từng nằm ở
   * devDependencies, nên ảnh `--omit=dev` không có nó. Build vẫn xanh; container
   * mới chết lúc khởi động, hoặc tệ hơn — `npx` đi tải gói từ mạng ngay trong
   * lớp chạy production.
   */
  it('mọi lệnh trong CMD có mặt ở dependencies', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const cmd = dockerCode.match(/^CMD \[(.+)\]$/m);
    assert.ok(cmd, 'Dockerfile không có CMD dạng exec');
    const argv = (JSON.parse(`[${cmd[1]}]`) as string[]);
    const binary = argv[0] === 'npx' ? argv[1] : argv[0];
    assert.ok(binary, 'CMD rỗng');
    if (binary === 'node') return;
    assert.ok(
      pkg.dependencies[binary],
      `CMD gọi "${binary}" nhưng nó ${pkg.devDependencies[binary] ? 'nằm ở devDependencies' : 'không có trong package.json'}`,
    );
  });
});

describe('nginx: WebSocket', () => {
  /**
   * Hôm nay chưa route nào dùng WebSocket — video đi bằng SSE. Nhưng hai dòng
   * này là loại thiếu-thì-hỏng-lặng-lẽ: nginx trả 400 cho cái bắt tay Upgrade,
   * ở một tầng mà không ai nghĩ tới, nên chúng phải có sẵn TRƯỚC khi có route
   * cần chúng.
   */
  it('chuyển tiếp được cái bắt tay Upgrade', () => {
    const conf = nginx.replace(/^\s*#.*$/gm, '');
    assert.match(conf, /proxy_set_header\s+Upgrade\s+\$http_upgrade;/);
    assert.match(conf, /proxy_set_header\s+Connection\s+\$connection_upgrade;/);
  });

  /**
   * `Connection: upgrade` đặt cứng cho mọi request sẽ phá keepalive của đường
   * HTTP thường, nên giá trị phải đi qua một `map` — và `map` chỉ hợp lệ ở tầm
   * `http`, ngoài mọi `location`.
   */
  it('giá trị Connection đi qua map, không đặt cứng', () => {
    const conf = nginx.replace(/^\s*#.*$/gm, '');
    assert.match(conf, /map\s+\$http_upgrade\s+\$connection_upgrade\s*\{/);
    assert.doesNotMatch(conf, /proxy_set_header\s+Connection\s+["']?upgrade["']?;/i);
  });
});

describe('.dockerignore', () => {
  /**
   * Một bản copy của secrets trong layer Docker là bản copy không ai xoá được
   * nữa — kể cả khi file gốc đã đổi, kể cả khi ảnh đã được push đi.
   */
  it('giữ bí mật và dữ liệu máy phát triển ở ngoài', () => {
    for (const entry of ['.testpilot.secrets.json', '.testpilot', '.env', 'testpilot.config.json']) {
      assert.ok(
        dockerignore.split('\n').some((line) => line.trim() === entry),
        `.dockerignore thiếu "${entry}"`,
      );
    }
  });

  it('giữ artifact nặng ở ngoài', () => {
    for (const entry of ['runs', 'artifacts', 'build', 'node_modules']) {
      assert.ok(
        dockerignore.split('\n').some((line) => line.trim() === entry),
        `.dockerignore thiếu "${entry}"`,
      );
    }
  });
});
