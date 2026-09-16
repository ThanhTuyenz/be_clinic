import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';

const envFile = process.env.ENV_FILE || '.env.development';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Thiếu DATABASE_URL trong biến môi trường!');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

async function main() {
  console.log('🚀 Đang kết nối CSDL để dọn dẹp các bảng và cột Auth cũ...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🗑️  Xóa các bảng sessions, password_reset_tokens, auth_verification_tokens...');
    await client.query(`
      DROP TABLE IF EXISTS "sessions" CASCADE;
      DROP TABLE IF EXISTS "password_reset_tokens" CASCADE;
      DROP TABLE IF EXISTS "auth_verification_tokens" CASCADE;
    `);

    console.log('🗑️  Xóa 4 cột OTP tạm trong bảng users...');
    await client.query(`
      ALTER TABLE "users" 
        DROP COLUMN IF EXISTS "email_otp_hash",
        DROP COLUMN IF EXISTS "email_otp_expires_at",
        DROP COLUMN IF EXISTS "email_otp_last_sent_at",
        DROP COLUMN IF EXISTS "email_otp_attempts";
    `);

    await client.query('COMMIT');
    console.log('✅ ĐÃ DỌN DẸP THÀNH CÔNG 3 BẢNG VÀ 4 CỘT TRONG POSTGRESQL!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Lỗi khi dọn dẹp database:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
