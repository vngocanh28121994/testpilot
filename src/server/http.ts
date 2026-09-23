/**
 * Vỏ HTTP của control plane: khởi tạo, helper, phục vụ file tĩnh.
 *
 * Tách ra khỏi `src/ui/server.ts` như bước đầu của P1. Ở bước này **không một
 * hành vi nào đổi** — hàm được chuyển nguyên văn, kể cả chú thích giải thích vì
 * sao chúng làm như thế. Việc chia route theo miền là P1.2, và trộn hai việc ấy
 * vào nhau là cách chắc chắn nhất để không biết lỗi đến từ đâu.
 *
 * Vì sao vỏ HTTP phải đi trước: phần còn lại của P1 sẽ chuyển mọi thứ chạm tới
 * thiết bị sang `src/runner/`, và cái còn lại ở đây phải là một server thuần —
 * đọc, ghi, chuyển tiếp. Xem [FARM-PLAN.md](../../FARM-PLAN.md) P1.1.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagesDone, type WorkflowRun } from '../core/history.js';

/**
 * Chế độ chạy.
 *
 *  - `embedded`: bản local như hôm nay. Một người dùng, một máy, không đăng
 *    nhập, dữ liệu là file trên đĩa. Đây vẫn là mặc định, và là lý do mục 9 của
 *    tài liệu kiến trúc tồn tại: bản local không được vỡ trong lúc xây phần farm.
 *  - `server`: control plane trên domain. Có đăng nhập, có DB, và **không được
 *    phép** chạy lệnh thiết bị — những route ấy sang runner.
 */
export type ServerMode = 'embedded' | 'server';

export function serverMode(raw = process.env.TESTPILOT_MODE): ServerMode {
  return raw?.trim() === 'server' ? 'server' : 'embedded';
}

export const PORT = Number(process.env.TESTPILOT_UI_PORT ?? 4300);

/** Vite bundle duy nhất sau cutover. `/api` và artifact paths vẫn do server này sở hữu. */
export const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'dist',
  'ui',
  'app',
);

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  // Without the right type the browser downloads the recording instead of
  // playing it inline, which defeats the point of embedding it.
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return (raw ? JSON.parse(raw) : {}) as T;
}

/**
 * Khung SSE thô: mở đầu, gửi từng sự kiện có tên, đóng.
 *
 * Tách ra vì luồng video của màn điều khiển sống theo cách khác với `stream()`:
 * nó không bọc quanh một công việc có điểm kết, mà chảy tới khi người xem đóng
 * tab hoặc mất lease. Cả hai vẫn phải viết khung SSE giống nhau tới từng dấu
 * xuống dòng — hai chỗ tự viết lấy là hai chỗ có thể quên dòng trắng cuối, và
 * thiếu nó thì trình duyệt giữ sự kiện trong bộ đệm mãi mãi.
 */
export function sse(res: ServerResponse): {
  send: (event: string, data: unknown) => boolean;
  end: () => void;
} {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    // Nginx bỏ đệm cho đường này, kể cả khi cấu hình chung có bật đệm. Không
    // có nó thì log và video đọng lại thành một cục sau hai phút.
    'x-accel-buffering': 'no',
  });
  // Tắt Nagle. Thuật toán ấy gom những lần ghi nhỏ lại rồi gửi một thể — đúng
  // cho việc tải file, sai cho một luồng thời gian thực: khung hình đi thành
  // từng cụm thay vì đều đặn, và người xem thấy giật dù tổng băng thông thừa.
  // Luồng màn hình đo được 100 gói mỗi giây, mỗi gói vài KB — đúng hình dạng
  // mà Nagle gom lại nhiều nhất.
  res.socket?.setNoDelay(true);

  return {
    send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    end: () => res.end(),
  };
}

/**
 * Server-sent events over a POST, read by the client with a stream reader.
 * Two channels: `log` for console lines, `run` for the stage tracker that draws
 * the progress list and the "3/7" cell.
 */
export async function stream(
  res: ServerResponse,
  job: (log: (l: string) => void, stage: (run: WorkflowRun) => void) => Promise<void>,
  onError?: (err: unknown) => Promise<WorkflowRun | undefined>,
): Promise<void> {
  const { send } = sse(res);

  try {
    await job(
      (line) => send('log', line),
      // The log array would double every frame; the client already has the lines.
      (run) => send('run', { ...run, log: undefined, stagesDone: stagesDone(run) }),
    );
    send('done', { ok: true });
  } catch (err) {
    try {
      const failedRun = await onError?.(err);
      if (failedRun) {
        send('run', { ...failedRun, log: undefined, stagesDone: stagesDone(failedRun) });
      }
    } catch {
      // Keep the original failure visible even when persisting its history fails.
    }
    send('error', (err as Error).message);
    send('done', { ok: false });
  }
  res.end();
}

/**
 * Serves a file, honouring HTTP Range.
 *
 * Range is what makes a video seekable. Without it the browser gets one opaque
 * 200 and the scrubber does nothing — which is how a two-minute recording of a
 * test run became something you had to watch from the beginning, every time,
 * including the ten seconds of Appium starting up.
 */
export async function serveFile(
  res: ServerResponse,
  file: string,
  range?: string,
): Promise<void> {
  if (!existsSync(file)) return json(res, 404, { error: `Not found: ${file}` });
  const body = await readFile(file);
  const headers: Record<string, string> = {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    // Vite hash tên asset. Cache dài cho asset là an toàn; index.html luôn
    // no-store để lần mở sau nhận được manifest asset mới nhất.
    'cache-control': path.basename(file) === 'index.html'
      ? 'no-store'
      : file.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
  };

  const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
  if (match) {
    const [, rawStart, rawEnd] = match;
    const start = rawStart ? Number(rawStart) : undefined;
    const end = rawEnd ? Number(rawEnd) : undefined;
    // `bytes=-500` means the last 500 bytes, not "from 0 to 500".
    const from = start !== undefined ? start : Math.max(0, body.length - (end ?? 0));
    const to = start !== undefined ? Math.min(end ?? body.length - 1, body.length - 1) : body.length - 1;
    if (from > to || from >= body.length) {
      res.writeHead(416, { 'content-range': `bytes */${body.length}` });
      res.end();
      return;
    }
    const slice = body.subarray(from, to + 1);
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${from}-${to}/${body.length}`,
      'content-length': String(slice.length),
    });
    res.end(slice);
    return;
  }

  res.writeHead(200, { ...headers, 'content-length': String(body.length) });
  res.end(body);
}

/** Thư mục artifact mà server chịu trách nhiệm phục vụ, theo đúng thứ tự cũ. */
export const ARTIFACT_DIRS = ['runs', 'reports', 'artifacts'] as const;

/**
 * File tĩnh: artifact của lượt chạy, rồi tới bundle React.
 *
 * Trả `true` khi đã trả lời xong. Người gọi chỉ việc `return` — giữ nguyên hình
 * dạng cũ của `handle()`, nơi hai khối này nằm cuối cùng sau bảng route.
 *
 * Kiểm tra `startsWith(root + sep)` là chốt chặn path traversal: thiếu nó thì
 * `/runs/../../.ssh/id_rsa` là một request hợp lệ. Đây cũng là chỗ P2.5 sẽ
 * thay bằng link có chữ ký của S3, nên nó phải có test trước khi bị đụng vào.
 */
export async function serveStaticRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method !== 'GET') return false;

  // A run directory holds its own screenshots and videos, so serving `runs`
  // is enough for a current report. `reports` and `artifacts` stay reachable
  // for runs recorded under the old per-platform layout.
  for (const dir of ARTIFACT_DIRS) {
    if (url.pathname.startsWith(`/${dir}/`)) {
      const root = path.resolve(dir);
      const file = path.resolve(root, url.pathname.replace(new RegExp(`^/${dir}/+`), ''));
      if (!file.startsWith(root + path.sep)) {
        json(res, 403, { error: 'forbidden' });
        return true;
      }
      await serveFile(res, file, req.headers.range);
      return true;
    }
  }

  if (!existsSync(PUBLIC_DIR)) {
    json(res, 503, { error: 'Chưa build UI. Chạy `npm run ui:build`.' });
    return true;
  }
  const rel = url.pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel || 'index.html');
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    json(res, 403, { error: 'forbidden' });
    return true;
  }
  if (rel && existsSync(file) && statSync(file).isFile()) {
    await serveFile(res, file, req.headers.range);
    return true;
  }
  // SPA fallback cho route React. Asset thiếu vẫn trả 404 JSON để browser
  // không cố parse index.html thành JavaScript.
  if (path.extname(rel)) {
    json(res, 404, { error: `Not found: ${rel}` });
    return true;
  }
  await serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  return true;
}

/**
 * Mở cổng.
 *
 * Lỗi ném ra từ handler được bắt ở đây chứ không ở từng route: một route quên
 * try/catch sẽ làm sập cả tiến trình, và tiến trình ấy đang giữ những lượt chạy
 * bấm vào thiết bị thật.
 */
export function listen(
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  port = PORT,
): Server {
  return createServer((req, res) => {
    handle(req, res).catch((err: Error) => {
      if (!res.headersSent) json(res, 500, { error: err.message });
      else res.end();
    });
  }).listen(port, () => {
    console.log(`TestPilot UI  →  http://localhost:${port}`);
  });
}
