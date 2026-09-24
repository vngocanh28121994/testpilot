/**
 * Đăng xuất rồi bấm Đăng nhập lại thì tự vào đúng tài khoản cũ, không hỏi gì:
 * TestPilot chỉ xoá phiên của nó, phiên Keycloak vẫn sống. Thử bốn vai trên
 * máy chủ nội bộ là không đổi được sang tài khoản khác.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OidcClient, SIGNED_OUT_STATE } from '../oidc.js';

const ISSUER = 'http://10.33.86.211:8080/realms/testpilot';

function fakeFetch(discovery: Record<string, unknown>): typeof fetch {
  return (async () => new Response(JSON.stringify(discovery), {
    status: 200, headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
}

const config = {
  issuer: ISSUER,
  clientId: 'testpilot',
  clientSecret: 's',
  redirectUri: 'http://10.33.86.211:4300/api/auth/callback',
};

describe('OidcClient.logoutUrl', () => {
  it('đăng xuất ở nhà cung cấp rồi quay về callback, có dấu signed-out', async () => {
    const client = new OidcClient(config, fakeFetch({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/auth`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/certs`,
      end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
    }));
    const url = new URL((await client.logoutUrl())!);
    assert.equal(`${url.origin}${url.pathname}`, `${ISSUER}/protocol/openid-connect/logout`);
    assert.equal(url.searchParams.get('client_id'), 'testpilot');
    assert.equal(url.searchParams.get('post_logout_redirect_uri'), config.redirectUri);
    assert.equal(url.searchParams.get('state'), SIGNED_OUT_STATE);
  });

  it('nhà cung cấp không có end_session_endpoint: không có gì để chuyển', async () => {
    const client = new OidcClient(config, fakeFetch({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/auth`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/certs`,
    }));
    assert.equal(await client.logoutUrl(), undefined);
  });
});
