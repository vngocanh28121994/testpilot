/** Dựng một phiên đăng nhập thật để thử tay. Chỉ dùng lúc phát triển. */
import { connect } from '../server/db/connect.js';
import { PgSessionStore } from '../server/auth/pgSession.js';

async function main(): Promise<void> {
  const pool = await connect({ url: process.env.TESTPILOT_DATABASE_URL! });
  const session = await new PgSessionStore(pool).create({
    userId: 'an', orgId: 'local', email: 'an@x.dev', role: 'admin',
  });
  console.log(session.id);
  await pool.end();
}

void main();
