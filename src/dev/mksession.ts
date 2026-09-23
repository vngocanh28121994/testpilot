/** Dựng một phiên đăng nhập thật để thử tay. Chỉ dùng lúc phát triển. */
import { connect } from '../server/db/connect.js';
import { PgSessionStore } from '../server/auth/pgSession.js';
import { bootstrapUser } from '../server/auth/bootstrapUser.js';
import type { Identity } from '../server/auth/roles.js';

async function main(): Promise<void> {
  const pool = await connect({ url: process.env.TESTPILOT_DATABASE_URL! });
  const identity: Identity = {
    userId: 'an', orgId: 'default', email: 'an@x.dev', role: 'admin',
  };
  // Cùng đường mà đăng nhập thật đi qua: ghi sổ người dùng trước, rồi mới
  // phát phiên. Bỏ bước đầu thì phiên vẫn dùng được cho tới lệnh ghi đầu tiên.
  await bootstrapUser(async () => pool, identity);
  const session = await new PgSessionStore(pool).create(identity);
  console.log(session.id);
  await pool.end();
}

void main();
