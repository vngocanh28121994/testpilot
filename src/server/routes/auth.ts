/**
 * Đăng nhập, đăng xuất, và "tôi là ai".
 *
 * Bốn route này là những route DUY NHẤT gọi được khi chưa có phiên — xem
 * `PUBLIC_ROUTES` trong `policy.ts`. Mọi route khác đi qua cửa quyền.
 *
 * Luồng: `/api/auth/login` đẩy sang nhà cung cấp; người dùng đăng nhập ở đó;
 * nhà cung cấp gọi lại `/api/auth/callback` kèm `code`; server đổi code lấy
 * `id_token`, kiểm chữ ký, tra vai trong danh bạ thành viên, rồi mở phiên.
 */
import { loadConfig } from '../../config.js';
import { json, serverMode } from '../http.js';
import { FileMemberDirectory, type MemberDirectory } from '../auth/members.js';
import { LoginAttempts, OidcClient, oidcConfigFromEnv, SIGNED_OUT_STATE } from '../auth/oidc.js';
import type { Identity } from '../auth/roles.js';
import { clearedSessionCookie, sessionCookie, sessionIdFromCookie } from '../auth/session.js';
import type { RouteTable } from './types.js';

const attempts = new LoginAttempts();
const members: MemberDirectory = new FileMemberDirectory();

/**
 * Một tổ chức cho tới khi P5 có nhiều.
 *
 * Viết ra thành hằng số có tên thay vì rải chuỗi `'default'` khắp nơi: khi P5
 * tới, chỗ cần sửa là một dòng, và `grep` tìm được nó.
 */
const DEFAULT_ORG = 'default';

function client(): OidcClient | undefined {
  const config = oidcConfigFromEnv();
  return config ? new OidcClient(config) : undefined;
}

/**
 * Chỉ cho quay về đường dẫn NỘI BỘ.
 *
 * `returnTo` đến từ query string, tức là từ bất kỳ ai gửi được một đường link.
 * Không lọc thì đây là một cú chuyển hướng mở: link trông như của TestPilot,
 * đăng nhập thật, rồi bị đẩy sang một trang giả chờ sẵn.
 */
function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function redirect(res: Parameters<RouteTable[string]>[1], to: string, cookie?: string): void {
  res.writeHead(302, {
    location: to,
    ...(cookie ? { 'set-cookie': cookie } : {}),
  });
  res.end();
}

export const authRoutes: RouteTable = {
  /** Ai đang đăng nhập. Giao diện gọi nó để biết nên vẽ gì. */
  'GET /api/auth/me': async (req, res, _url, ctx) => {
    if (serverMode() === 'embedded') {
      return json(res, 200, { mode: 'embedded', authenticated: true, identity: null });
    }
    const id = sessionIdFromCookie(req.headers.cookie);
    const session = id ? await ctx.sessions.find(id) : undefined;
    if (!session) return json(res, 200, { mode: 'server', authenticated: false, identity: null });
    const { userId, email, role, orgId } = session.identity;
    return json(res, 200, {
      mode: 'server',
      authenticated: true,
      identity: { userId, email, role, orgId },
    });
  },

  'GET /api/auth/login': async (_req, res, url) => {
    const oidc = client();
    if (!oidc) {
      return json(res, 501, {
        error: 'Chưa cấu hình OIDC. Xem .env.server.example và infra/README.md.',
      });
    }
    const { state, nonce, verifier } = attempts.start(safeReturnTo(url.searchParams.get('returnTo')));
    try {
      return redirect(res, await oidc.authorizationUrl({ state, nonce, codeVerifier: verifier }));
    } catch (err) {
      // Nhà cung cấp không trả lời thì nói ra ngay ở đây. Đẩy người dùng sang
      // một URL dựng dở sẽ cho họ một trang lỗi của Keycloak, và họ sẽ đi tìm
      // nguyên nhân ở phía bên kia.
      return json(res, 502, { error: `Không liên hệ được nhà cung cấp đăng nhập: ${(err as Error).message}` });
    }
  },

  'GET /api/auth/callback': async (_req, res, url, ctx) => {
    const oidc = client();
    if (!oidc) return json(res, 501, { error: 'Chưa cấu hình OIDC.' });

    const error = url.searchParams.get('error');
    if (error) {
      return json(res, 401, {
        error: `Nhà cung cấp từ chối đăng nhập: ${error} — ${url.searchParams.get('error_description') ?? ''}`,
      });
    }

    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';
    // Vừa đăng xuất ở nhà cung cấp xong (xem `logoutUrl`): không có gì để đổi
    // lấy phiên, chỉ việc về trang chủ — nơi màn đăng nhập đang chờ.
    if (state === SIGNED_OUT_STATE && !code) return redirect(res, '/');
    const attempt = attempts.take(state);
    if (!attempt || !code) {
      // `state` không khớp là dấu hiệu của CSRF hoặc của một cú bấm lại trên
      // một tab đã cũ. Cả hai đều phải bắt đầu lại, và không tiết lộ là cái nào.
      return json(res, 400, { error: 'Yêu cầu đăng nhập không hợp lệ hoặc đã hết hạn.' });
    }

    try {
      const { idToken } = await oidc.exchangeCode(code, attempt.verifier);
      const claims = await oidc.verifyIdToken(idToken, attempt.nonce);
      const email = String(claims.email ?? '').trim();
      if (!email) {
        return json(res, 403, { error: 'id_token không mang email — không xác định được người dùng.' });
      }

      const role = await members.roleFor(DEFAULT_ORG, email);
      if (!role) {
        // Đăng nhập được KHÔNG có nghĩa là thuộc tổ chức. Nói rõ khác biệt ấy,
        // vì nó là khác biệt giữa "gõ sai mật khẩu" và "chưa được thêm vào".
        return json(res, 403, {
          error: `${email} đăng nhập thành công nhưng chưa thuộc tổ chức nào trong TestPilot. `
            + 'Nhờ một admin thêm bạn vào.',
        });
      }

      const identity: Identity = {
        userId: String(claims.sub ?? email),
        orgId: DEFAULT_ORG,
        email,
        role,
      };
      // Ghi vào sổ người dùng TRƯỚC khi phát phiên: những bảng khác trỏ vào
      // `app_user`, và một người có phiên hợp lệ mà không có dòng trong sổ sẽ
      // gặp lỗi khoá ngoại ở lệnh ghi đầu tiên — rất xa chỗ nguyên nhân.
      await ctx.bootstrapUser?.(identity);
      const session = await ctx.sessions.create(identity);
      const secure = new URL(oidcConfigFromEnv()!.redirectUri).protocol === 'https:';
      return redirect(res, attempt.returnTo, sessionCookie(session.id, { secure }));
    } catch (err) {
      return json(res, 401, { error: `Đăng nhập thất bại: ${(err as Error).message}` });
    }
  },

  /**
   * Đăng xuất khỏi TestPilot, KHÔNG khỏi SSO của công ty.
   *
   * Cố ý. Với SSO, bấm "đăng xuất" ở một ứng dụng mà kéo theo đăng xuất khỏi
   * mail, lịch và mọi thứ khác là một bất ngờ khó chịu. Ai muốn thoát hẳn thì
   * đăng xuất ở nhà cung cấp — `end_session_endpoint` có sẵn trong discovery
   * nếu về sau cần thêm nút ấy.
   *
   * Đổi 2026-09-24: đăng xuất giờ trả kèm `redirect` — địa chỉ đăng xuất ở
   * nhà cung cấp — và giao diện chuyển sang đó. Chỉ xoá phiên của ta thì bấm
   * Đăng nhập lại sẽ tự vào đúng tài khoản cũ mà không hỏi gì (phiên SSO còn
   * sống), và người dùng không có cách nào đổi sang tài khoản khác — đúng
   * chuyện đã xảy ra khi thử bốn vai trên máy chủ nội bộ.
   */
  'POST /api/auth/logout': async (req, res, _url, ctx) => {
    const id = sessionIdFromCookie(req.headers.cookie);
    // Thu hồi ở PHÍA SERVER, không chỉ xoá cookie. Xoá cookie là bảo trình
    // duyệt quên đi; bản sao mã phiên ở đâu đó vẫn đăng nhập được.
    if (id) await ctx.sessions.revoke(id);
    // Nhà cung cấp không trả lời thì vẫn đăng xuất được ở phía ta — chỉ là lần
    // đăng nhập sau có thể tự vào lại tài khoản cũ.
    const providerLogout = await client()?.logoutUrl().catch(() => undefined);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': clearedSessionCookie(),
    });
    res.end(JSON.stringify({ ok: true, ...(providerLogout ? { redirect: providerLogout } : {}) }));
  },
};

/** Dùng ở route quản trị thành viên (P5) và trong test. */
export { members as memberDirectory, DEFAULT_ORG, loadConfig as _loadConfig };
