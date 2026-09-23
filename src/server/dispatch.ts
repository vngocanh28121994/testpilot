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
    };
    return handler(req, res, url, ctx);
  }

  if (await serveStaticRequest(req, res, url)) return;

  json(res, 404, { error: `No route for ${route}` });
}
