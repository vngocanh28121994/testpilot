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

export interface DispatchDeps extends GuardDeps {
  mode: ServerMode;
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
    };
    return handler(req, res, url, ctx);
  }

  if (await serveStaticRequest(req, res, url)) return;

  json(res, 404, { error: `No route for ${route}` });
}
