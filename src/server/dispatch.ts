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
import type { RouteContext } from './routes/types.js';

export interface DispatchDeps extends GuardDeps {
  mode: ServerMode;
  configFile: string;
  configProfile: RouteContext['configProfile'];
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
    };
    return handler(req, res, url, ctx);
  }

  if (await serveStaticRequest(req, res, url)) return;

  json(res, 404, { error: `No route for ${route}` });
}
