/**
 * Cửa duy nhất: mọi request đi qua đây trước khi tới handler.
 *
 * "Duy nhất" là điều kiện, không phải mô tả. Mỗi chỗ kiểm tra quyền thêm là
 * một chỗ có thể quên kiểm tra, và cái quên ấy không bao giờ tự lộ ra — route
 * vẫn chạy, chỉ là chạy cho người lẽ ra không được gọi. Nên kiểm tra nằm ở
 * tầng điều phối, và `policyGuard.test.ts` canh cho không route nào lọt.
 *
 * Xem [FARM-PLAN.md](../../../FARM-PLAN.md) P2.1 và P2.2.
 */
import type { IncomingMessage } from 'node:http';
import type { ServerMode } from '../http.js';
import { PUBLIC_ROUTES, RUNNER_ROUTES, requiredRole } from './policy.js';
import { bearer, runnerIdentity, runnerToken, tokenMatches } from './runnerToken.js';
import { allows, ANONYMOUS, LOCAL_IDENTITY, type Identity } from './roles.js';
import { sessionIdFromCookie, type SessionStore } from './session.js';

export type AuthDecision =
  | { ok: true; identity: Identity }
  | { ok: false; status: 401 | 403 | 501; error: string };

export interface GuardDeps {
  mode: ServerMode;
  sessions?: SessionStore;
}

/**
 * Ai được gọi route này, và có được không.
 *
 * Ở chế độ `embedded` mọi request là của chính người đang ngồi trước máy: họ
 * sửa được file config bằng editor, dừng được tiến trình bằng Ctrl-C. Dựng một
 * hàng rào ở đây chỉ tạo ra cảm giác an toàn, nên không dựng — và đó là quyết
 * định phải nói ra, chứ không phải một nhánh `if` không ai để ý.
 */
export async function authorize(
  req: IncomingMessage,
  route: string,
  deps: GuardDeps,
): Promise<AuthDecision> {
  const need = requiredRole(route);
  if (!need) {
    // Route có thật nhưng chưa ai quyết định ai được gọi. Mặc định là CẤM:
    // một route mới lọt ra ngoài mà không ai nhận ra là kiểu hỏng đắt nhất ở
    // đây, và 501 nói đúng chuyện gì đang xảy ra thay vì giả vờ là 403.
    return {
      ok: false,
      status: 501,
      error: `Route "${route}" chưa khai báo quyền trong policy.ts.`,
    };
  }

  /**
   * Đường của runner đi TRƯỚC nhánh embedded.
   *
   * Vì sao trước: ở chế độ embedded mọi request được coi là của chính người
   * ngồi trước máy, và nếu bốn route runner rơi vào nhánh ấy thì chúng mở toang
   * — một trang web bất kỳ trong cùng trình duyệt cũng gọi được chúng và nhận
   * job của tổ chức. Runner luôn phải trình token, ở cả hai chế độ.
   */
  if (RUNNER_ROUTES.has(route)) {
    const expected = runnerToken();
    if (!expected) {
      return {
        ok: false, status: 401,
        error: 'Server chưa đặt TESTPILOT_RUNNER_TOKEN nên đường runner đang đóng.',
      };
    }
    const given = bearer(req);
    if (!given || !tokenMatches(given, expected)) {
      return { ok: false, status: 401, error: 'Token runner không đúng.' };
    }
    // Tên runner chỉ để đọc log; nó KHÔNG quyết định quyền gì, nên nhận thẳng
    // từ header là đủ và không cần kiểm.
    const name = String(req.headers['x-runner-name'] ?? 'unknown').slice(0, 64);
    return { ok: true, identity: runnerIdentity(name) };
  }

  if (deps.mode === 'embedded') return { ok: true, identity: LOCAL_IDENTITY };

  // Đăng nhập không thể đòi đăng nhập trước. Bốn route ấy tự lo phần an toàn
  // của mình: `state` dùng một lần, `nonce` kiểm trong id_token, và `returnTo`
  // chỉ nhận đường dẫn nội bộ.
  if (PUBLIC_ROUTES.has(route)) return { ok: true, identity: ANONYMOUS };

  const sessionId = sessionIdFromCookie(req.headers.cookie);
  if (!sessionId || !deps.sessions) {
    return { ok: false, status: 401, error: 'Cần đăng nhập.' };
  }
  const session = await deps.sessions.find(sessionId);
  if (!session) {
    // Hết hạn và không tồn tại trả lời giống nhau, cố ý: phân biệt hai cái đó
    // là nói cho người lạ biết mã nào từng có thật.
    return { ok: false, status: 401, error: 'Phiên đăng nhập đã hết hạn.' };
  }

  if (!allows(session.identity.role, need)) {
    return {
      ok: false,
      status: 403,
      error: `Việc này cần vai "${need}"; tài khoản của bạn là "${session.identity.role}".`,
    };
  }
  return { ok: true, identity: session.identity };
}
