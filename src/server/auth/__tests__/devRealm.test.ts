/**
 * Môi trường thử phải khớp với code, và khớp một cách kiểm tra được.
 *
 * Realm của Keycloak nằm trong git để hai máy giống nhau. Nhưng "nằm trong
 * git" không có nghĩa là "còn đúng": đổi tên một vai trong `roles.ts` xong,
 * realm vẫn nhập được, Keycloak vẫn chạy, và chỉ tới lúc ai đó đăng nhập bằng
 * tài khoản thử mới thấy vai đó không còn ánh xạ được sang đâu cả.
 *
 * Nên chỗ nối giữa hai bên được canh bằng test: tên vai, client id, và địa chỉ
 * callback — ba thứ mà lệch một cái là đăng nhập hỏng với thông báo của
 * Keycloak chứ không phải của TestPilot, và người đọc sẽ đi tìm sai chỗ.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROLES } from '../roles.js';

const realm = JSON.parse(readFileSync('infra/keycloak/testpilot-realm.json', 'utf8')) as {
  realm: string;
  roles: { realm: Array<{ name: string; description?: string }> };
  clients: Array<{ clientId: string; secret?: string; redirectUris: string[]; publicClient: boolean }>;
  users: Array<{ username: string; realmRoles: string[]; credentials: Array<{ value: string }> }>;
};
const envExample = readFileSync('.env.server.example', 'utf8');
const compose = readFileSync('docker-compose.yml', 'utf8');

function envValue(name: string): string | undefined {
  return new RegExp(`^${name}=(.*)$`, 'm').exec(envExample)?.[1]?.trim();
}

describe('realm Keycloak dùng để thử', () => {
  it('có đủ bốn vai, đúng tên mà code dùng', () => {
    const declared = realm.roles.realm.map((r) => r.name).sort();
    assert.deepEqual(declared, [...ROLES].sort());
  });

  /** Mỗi vai một tài khoản: thiếu một cái là thiếu đúng ca cần thử nhất. */
  it('mỗi vai có một tài khoản thử', () => {
    const covered = new Set(realm.users.flatMap((u) => u.realmRoles));
    for (const role of ROLES) {
      assert.ok(covered.has(role), `không có tài khoản nào mang vai "${role}"`);
    }
  });

  /** Quy ước đã ghi trong infra/README.md; lệch là người dùng không đăng nhập được. */
  it('mật khẩu trùng tên đăng nhập, đúng như README nói', () => {
    for (const user of realm.users) {
      assert.equal(user.credentials[0]?.value, user.username, `${user.username}: mật khẩu khác tên`);
    }
  });

  it('client id và secret khớp .env.server.example', () => {
    const client = realm.clients[0]!;
    assert.equal(client.clientId, envValue('TESTPILOT_OIDC_CLIENT_ID'));
    assert.equal(client.secret, envValue('TESTPILOT_OIDC_CLIENT_SECRET'));
  });

  /**
   * Keycloak từ chối mọi redirect không nằm trong danh sách, và thông báo lúc
   * ấy là của Keycloak — người đọc sẽ đi tìm lỗi trong TestPilot.
   */
  it('địa chỉ callback trong .env nằm trong danh sách cho phép của client', () => {
    const redirect = envValue('TESTPILOT_OIDC_REDIRECT_URI')!;
    assert.ok(
      realm.clients[0]!.redirectUris.includes(redirect),
      `${redirect} chưa có trong redirectUris của client`,
    );
  });

  /**
   * Confidential client: secret nằm ở server. Đổi sang public client là bỏ đi
   * một lớp phòng thủ mà ta không cần bỏ — server này có chỗ giữ bí mật.
   */
  it('là confidential client, không phải public', () => {
    assert.equal(realm.clients[0]!.publicClient, false);
    assert.ok(realm.clients[0]!.secret);
  });

  it('issuer trong .env trỏ đúng realm', () => {
    assert.match(envValue('TESTPILOT_OIDC_ISSUER') ?? '', new RegExp(`/realms/${realm.realm}$`));
  });
});

describe('docker-compose cho môi trường thử', () => {
  it('nhập realm lúc khởi động, không bắt ai bấm tay', () => {
    assert.match(compose, /--import-realm/);
    assert.match(compose, /\.\/infra\/keycloak:\/opt\/keycloak\/data\/import/);
  });

  /**
   * `minio/minio` trên Docker Hub trả "access denied" (đo 2026-09-21). Thông
   * báo của Docker dẫn người đọc đi đăng nhập Docker Hub — một việc không giải
   * quyết được gì. Ghim quay.io lại để lần sau không ai mất buổi sáng vì nó.
   */
  it('MinIO lấy từ quay.io, không từ Docker Hub', () => {
    assert.match(compose, /image: quay\.io\/minio\/minio/);
    assert.match(compose, /image: quay\.io\/minio\/mc/);
    assert.doesNotMatch(compose, /image: minio\/minio/);
  });

  it('bucket được tạo sẵn, không để code ứng dụng lo', () => {
    const bucket = envValue('TESTPILOT_S3_BUCKET')!;
    assert.match(compose, new RegExp(`mc mb --ignore-existing local/${bucket}`));
  });

  /** Postgres phải healthy trước khi migration chạy, nếu không lỗi rất khó hiểu. */
  it('Postgres có healthcheck', () => {
    assert.match(compose, /pg_isready -U testpilot/);
  });
});
