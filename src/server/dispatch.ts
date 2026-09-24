/**
 * Một request đi qua đâu: tra bảng route → qua cửa quyền → handler.
 *
 * Tách khỏi `src/ui/server.ts` vì cùng ba bước ấy phải đúng ở CẢ HAI chế độ.
 * Nếu host embedded tự ghép lấy còn host server ghép cách khác, thì sớm muộn
 * một bên có thêm một bước mà bên kia không có — và bước bị thiếu sẽ là bước
 * kiểm tra quyền, vì đó là bước duy nhất không làm gì khi mọi thứ bình thường.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, serveStaticRequest, type ServerMode } from './http.js';
import { authorize, type GuardDeps } from './auth/guard.js';
import { allRoutes } from './routes/index.js';
import { lazyRepos } from './db/lazyRepos.js';
import type { Repos } from './db/repo.js';
import type { Identity } from './auth/roles.js';
import type { RouteContext } from './routes/types.js';
import type { RunnerRegistry } from './runners/registry.js';
import type { DeviceRegistry } from './devices/registry.js';
import type { DeviceGrants } from './devices/grants.js';
import type { SessionStore } from './auth/session.js';
import type { ArtifactStore } from './storage/artifacts.js';
import type { ArtifactRepo } from './storage/artifactRepo.js';

/**
 * Sổ rỗng cho host chưa dựng sổ nào.
 *
 * Không `undefined`: route sẽ phải kiểm `if (ctx.runners)` ở mọi chỗ, và chỗ
 * quên kiểm sẽ là chỗ hỏng. Một sổ luôn trả "không có gì" thì mọi đường đều
 * dẫn tới cùng một câu trả lời trung thực.
 */
/** Sổ thiết bị rỗng — cùng lý do với `emptyRunners`. */
const emptyDevices: DeviceRegistry = {
  report: async () => {},
  list: async () => [],
  find: async () => undefined,
  markRunnerOffline: async () => 0,
};

/** Bảng quyền rỗng — không ai mượn được gì, và đó là câu trả lời an toàn. */
const emptyGrants: DeviceGrants = {
  grant: () => Promise.reject(new Error('Host này chưa dựng bảng quyền mượn máy.')),
  revoke: async () => false,
  forUser: async () => new Set<string>(),
  forDevice: async () => [],
};

/**
 * Kho phiên rỗng — chỉ gặp khi host không dựng phiên (bài test, chế độ lạ).
 *
 * `create` NÉM thay vì trả một phiên giả: một phiên không lưu được ở đâu là
 * một lần đăng nhập trông như thành công rồi 401 ở request kế tiếp, và người
 * dùng sẽ báo lỗi "đăng nhập không được" mà log không có gì.
 */
const emptySessions: SessionStore = {
  create: () => Promise.reject(new Error('Host này chưa dựng kho phiên đăng nhập.')),
  find: async () => undefined,
  revoke: async () => {},
  revokeUser: async () => {},
};

const emptyRunners: RunnerRegistry = {
  create: () => Promise.reject(new Error('Host này chưa dựng sổ runner.')),
  findByToken: async () => undefined,
  find: async () => undefined,
  list: async () => [],
  rotate: async () => undefined,
  revoke: async () => false,
  touch: async () => {},
  reportPrereq: async () => {},
  reapSilent: async () => 0,
};

export interface DispatchDeps extends GuardDeps {
  mode: ServerMode;
  /** Sổ thiết bị. Thiếu thì mọi danh sách máy đều rỗng — xem `emptyDevices`. */
  devices?: DeviceRegistry;
  configFile: string;
  configProfile: RouteContext['configProfile'];
  /**
   * Chọn kho dữ liệu cho người gọi này.
   *
   * Nhận `Identity` chứ không phải không nhận gì: ở chế độ server, kho phải bị
   * giới hạn theo `orgId` NGAY TỪ LÚC DỰNG, chứ không phải nhờ mỗi truy vấn
   * nhớ thêm điều kiện. Một truy vấn quên `WHERE org_id` thì không ai thấy, và
   * thứ nó trả về là dữ liệu của người khác.
   */
  repos: (identity: Identity) => Repos | Promise<Repos>;
  /** Ai được mượn máy của ai. Thiếu nó thì không ai mượn được gì. */
  grants?: DeviceGrants;
  /** Kho phiên. Thiếu nó thì không ai đăng nhập được. */
  sessions?: SessionStore;
  /** Kho artifact. Thiếu nó thì route artifact trả 501. */
  artifacts?: { store: ArtifactStore; repo: ArtifactRepo };
  /** Ghi người vừa đăng nhập vào sổ. Chỉ có ở chế độ server. */
  bootstrapUser?: (identity: Identity) => Promise<void>;
}

export async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: DispatchDeps,
): Promise<void> {
  const route = `${req.method} ${url.pathname}`;
  const handler = allRoutes[route];

  if (handler) {
    const decision = await authorize(req, route, deps);
    if (!decision.ok) return json(res, decision.status, { error: decision.error });
    const ctx: RouteContext = {
      configFile: deps.configFile,
      configProfile: deps.configProfile,
      identity: decision.identity,
      // Hoãn tới lời gọi đầu tiên: xem `lazyRepos`. Một route không đọc dữ
      // liệu — `GET /api/health` là ví dụ — không được chết vì kho chưa mở.
      repos: lazyRepos(() => deps.repos(decision.identity)),
      // Sổ runner dùng chung với cửa quyền: một sổ, một sự thật về "máy nào
      // được phép". Hai bản sao sẽ lệch nhau đúng lúc một token bị thu hồi.
      runners: deps.runners ?? emptyRunners,
      devices: deps.devices ?? emptyDevices,
      // Bảng quyền mượn máy đứng RIÊNG, không nằm trong sổ thiết bị: sổ thiết
      // bị là ảnh chụp mười giây một lần, còn một quyết định cho mượn thì phải
      // sống qua một lần khởi động lại. Xem `devices/grants.ts`.
      grants: deps.grants ?? emptyGrants,
      // CÙNG kho mà `authorize()` vừa đọc, không phải một bản thứ hai: route
      // đăng nhập tạo phiên và cửa quyền đọc phiên, và hai kho riêng cho ra
      // một hệ thống đăng nhập xong vẫn báo chưa đăng nhập.
      sessions: deps.sessions ?? emptySessions,
      // Không có kho thì KHÔNG truyền một bản giả: route artifact trả 501, và
      // đó là cách duy nhất người deploy biết mình quên TESTPILOT_S3_BUCKET.
      ...(deps.artifacts ? { artifacts: deps.artifacts } : {}),
      ...(deps.bootstrapUser ? { bootstrapUser: deps.bootstrapUser } : {}),
    };
    return handler(req, res, url, ctx);
  }

  if (await serveStaticRequest(req, res, url)) return;

  json(res, 404, { error: `Máy chủ không có chức năng ${route} — giao diện và máy chủ có thể đang khác phiên bản. Tải lại trang.` });
}
