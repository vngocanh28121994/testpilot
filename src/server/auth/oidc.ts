/**
 * Đăng nhập bằng OIDC: authorization code + PKCE, và tự kiểm chữ ký id_token.
 *
 * Không kéo thư viện OIDC vào, có lý do. Đường xác thực là đường mà một lỗ
 * hổng trong dependency trở thành lỗ hổng của mình, và thứ cần ở đây nhỏ:
 * đọc tài liệu discovery, dựng URL, đổi code lấy token, kiểm chữ ký RS256.
 * `node:crypto` làm được cả bốn — kể cả việc dựng khoá công khai từ JWK, thứ
 * thường là lý do người ta phải cài thêm một gói.
 *
 * Đổi sang SSO của công ty là đổi bốn biến môi trường. Code không biết mình
 * đang nói chuyện với Keycloak hay Azure AD; nó chỉ đọc tài liệu discovery của
 * issuer — đó là toàn bộ điểm của OIDC.
 *
 * Xem [infra/README.md](../../../infra/README.md) để dựng Keycloak thử.
 */
import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** `undefined` khi chưa cấu hình — chế độ embedded không cần, và không nên đòi. */
export function oidcConfigFromEnv(env = process.env): OidcConfig | undefined {
  const issuer = env.TESTPILOT_OIDC_ISSUER?.trim();
  const clientId = env.TESTPILOT_OIDC_CLIENT_ID?.trim();
  const clientSecret = env.TESTPILOT_OIDC_CLIENT_SECRET?.trim();
  const redirectUri = env.TESTPILOT_OIDC_REDIRECT_URI?.trim();
  if (!issuer || !clientId || !clientSecret || !redirectUri) return undefined;
  return { issuer, clientId, clientSecret, redirectUri };
}

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

/**
 * Tài liệu discovery và khoá công khai, nhớ trong bộ đệm.
 *
 * Nhà cung cấp XOAY KHOÁ. Một bộ đệm không hết hạn sẽ từ chối mọi token mới
 * sau lần xoay đầu tiên — và triệu chứng là "cả công ty không đăng nhập được"
 * vào một buổi sáng không ai đổi gì. Năm phút đủ ngắn để tự khỏi, đủ dài để
 * không hỏi lại ở mỗi lượt đăng nhập.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Đánh dấu lượt quay về callback sau khi đăng xuất ở nhà cung cấp. */
export const SIGNED_OUT_STATE = 'signed-out';

export class OidcClient {
  private discovery?: { at: number; value: Discovery };
  private jwks?: { at: number; keys: Jwk[] };

  constructor(
    private readonly config: OidcConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async discover(): Promise<Discovery> {
    if (this.discovery && this.now() - this.discovery.at < CACHE_TTL_MS) {
      return this.discovery.value;
    }
    const url = `${this.config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const res = await this.fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new Error(`Không đọc được cấu hình OIDC ở ${url}: HTTP ${res.status}.`);
    }
    const value = (await res.json()) as Discovery;
    // Issuer trong tài liệu phải trùng issuer ta hỏi. Lệch nghĩa là ta đang
    // đọc tài liệu của một bên khác — đúng hình dạng của một cú chuyển hướng
    // độc hại, và cũng là hình dạng của một biến môi trường gõ nhầm.
    if (value.issuer !== this.config.issuer) {
      throw new Error(
        `Issuer không khớp: cấu hình nói "${this.config.issuer}", `
        + `tài liệu discovery nói "${value.issuer}".`,
      );
    }
    this.discovery = { at: this.now(), value };
    return value;
  }

  /**
   * URL đẩy người dùng sang nhà cung cấp, kèm PKCE.
   *
   * PKCE dù đây là confidential client: nó chặn đúng một tình huống mà client
   * secret không chặn được — code bị chặn lại trên đường quay về (log proxy,
   * lịch sử trình duyệt, một extension) rồi dùng ở nơi khác.
   */
  async authorizationUrl(params: {
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<string> {
    const { authorization_endpoint } = await this.discover();
    const url = new URL(authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('code_challenge', codeChallenge(params.codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** Đổi code lấy token. Secret đi trong thân request, không trong URL. */
  async exchangeCode(code: string, codeVerifier: string): Promise<{ idToken: string }> {
    const { token_endpoint } = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code_verifier: codeVerifier,
    });
    const res = await this.fetcher(token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !payload.id_token) {
      throw new Error(
        `Đổi code lấy token thất bại (HTTP ${res.status})`
        + (payload.error ? `: ${payload.error} — ${payload.error_description ?? ''}` : '.'),
      );
    }
    return { idToken: payload.id_token };
  }

  private async keys(): Promise<Jwk[]> {
    if (this.jwks && this.now() - this.jwks.at < CACHE_TTL_MS) return this.jwks.keys;
    const { jwks_uri } = await this.discover();
    const res = await this.fetcher(jwks_uri, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Không đọc được JWKS: HTTP ${res.status}.`);
    const keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
    this.jwks = { at: this.now(), keys };
    return keys;
  }

  /**
   * Kiểm id_token và trả về claim.
   *
   * Bốn phép kiểm, và bỏ bất kỳ cái nào cũng có một cách khai thác cụ thể:
   *  - **chữ ký**: không kiểm thì ai cũng tự viết được một token nói mình là admin;
   *  - **iss**: không kiểm thì token của một realm khác (hoặc một IdP khác) dùng được ở đây;
   *  - **aud**: không kiểm thì token phát cho ứng dụng KHÁC của cùng công ty dùng được ở đây;
   *  - **nonce**: không kiểm thì một token cũ chặn được có thể phát lại.
   *
   * `exp` là phép kiểm thứ năm, và là cái duy nhất ai cũng nhớ.
   */
  async verifyIdToken(idToken: string, expectedNonce: string): Promise<Record<string, unknown>> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('id_token không đúng định dạng JWT.');
    const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

    const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString()) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256') {
      // Chỉ nhận đúng một thuật toán. Danh sách rộng là đường vào của lớp tấn
      // công "đổi alg" — kinh điển nhất là `alg: none`.
      throw new Error(`Chỉ chấp nhận id_token ký bằng RS256, nhận được "${header.alg}".`);
    }

    const keys = await this.keys();
    const jwk = keys.find((key) => key.kid === header.kid) ?? keys[0];
    if (!jwk) throw new Error('JWKS không có khoá nào để kiểm chữ ký.');

    const publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${rawHeader}.${rawPayload}`);
    if (!verifier.verify(publicKey, Buffer.from(rawSignature, 'base64url'))) {
      throw new Error('Chữ ký id_token không hợp lệ.');
    }

    const claims = JSON.parse(Buffer.from(rawPayload, 'base64url').toString()) as Record<
      string,
      unknown
    >;

    if (claims.iss !== this.config.issuer) {
      throw new Error(`id_token đến từ issuer khác: "${String(claims.iss)}".`);
    }
    const aud = claims.aud;
    const audiences = Array.isArray(aud) ? aud.map(String) : [String(aud)];
    if (!audiences.includes(this.config.clientId)) {
      throw new Error(`id_token không phát cho client này (aud=${audiences.join(',')}).`);
    }
    const exp = Number(claims.exp);
    if (!Number.isFinite(exp) || exp * 1000 <= this.now()) {
      throw new Error('id_token đã hết hạn.');
    }
    if (claims.nonce !== expectedNonce) {
      throw new Error('nonce không khớp — token này không thuộc lần đăng nhập vừa rồi.');
    }
    return claims;
  }

  async endSessionUrl(): Promise<string | undefined> {
    return (await this.discover()).end_session_endpoint;
  }

  /**
   * Địa chỉ đăng xuất ở nhà cung cấp, quay về callback của ta với
   * `state=${SIGNED_OUT_STATE}`.
   *
   * Quay về CALLBACK chứ không về trang chủ: nhà cung cấp chỉ chấp nhận địa chỉ
   * đã khai, và callback là địa chỉ duy nhất chắc chắn đã khai (Keycloak mặc
   * định `post.logout.redirect.uris = +`, tức là dùng lại danh sách callback).
   * Nhờ vậy đổi IP máy chủ không phải sửa thêm gì ở Keycloak.
   */
  async logoutUrl(): Promise<string | undefined> {
    const endpoint = await this.endSessionUrl();
    if (!endpoint) return undefined;
    const url = new URL(endpoint);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('post_logout_redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', SIGNED_OUT_STATE);
    return url.toString();
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Nơi giữ lần đăng nhập đang dở: state → verifier, nonce, chỗ quay về.
 *
 * Ở server, không ở cookie. Cookie sẽ khiến `code_verifier` đi qua trình duyệt
 * — thứ mà PKCE sinh ra để KHÔNG đi qua đó. Hạn ngắn vì một lần đăng nhập dở
 * dang không có lý do sống lâu hơn vài phút.
 *
 * Nhiều instance server thì chỗ này phải chung (Redis hoặc DB): cú bấm quay về
 * có thể rơi vào instance khác. Ghi lại ở đây vì đó đúng là loại lỗi chỉ xuất
 * hiện sau khi scale, và khi ấy không ai nhớ chỗ này.
 */
export class LoginAttempts {
  private readonly rows = new Map<
    string,
    { verifier: string; nonce: string; returnTo: string; at: number }
  >();

  constructor(private readonly ttlMs = 5 * 60 * 1000) {}

  start(returnTo: string, now = Date.now()): { state: string; nonce: string; verifier: string } {
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    this.rows.set(state, { verifier, nonce, returnTo, at: now });
    return { state, nonce, verifier };
  }

  /** Dùng MỘT LẦN: lấy ra là xoá, nên một `state` bị phát lại sẽ không khớp. */
  take(state: string, now = Date.now()):
    | { verifier: string; nonce: string; returnTo: string }
    | undefined {
    const row = this.rows.get(state);
    if (!row) return undefined;
    this.rows.delete(state);
    if (now - row.at > this.ttlMs) return undefined;
    return { verifier: row.verifier, nonce: row.nonce, returnTo: row.returnTo };
  }
}
