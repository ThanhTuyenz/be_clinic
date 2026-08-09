import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const allowedRoles = new Set(['admin', 'branch_manager', 'doctor', 'pharmacist', 'cashier', 'receptionist', 'patient']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const mongo = new MongoClient(process.env.MONGO_URI);
  await mongo.connect();
  const db = mongo.db(process.env.MONGO_DB_NAME || 'clinic');
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((item) => item.name));
  const candidates = ['user', 'users'].filter((name) => names.has(name));
  const report = { scanned: 0, imported: 0, updated: 0, skipped: 0, conflicts: [] };

  for (const collectionName of candidates) {
    const cursor = db.collection(collectionName).find({});
    for await (const source of cursor) {
      report.scanned += 1;
      const email = typeof source.email === 'string' ? source.email.trim().toLowerCase() : null;
      if (!email) { report.skipped += 1; report.conflicts.push({ sourceId: String(source._id), reason: 'MISSING_EMAIL' }); continue; }
      const rawRole = String(source.role || 'patient').toLowerCase();
      if (!allowedRoles.has(rawRole)) { report.skipped += 1; report.conflicts.push({ email, reason: `INVALID_ROLE:${rawRole}` }); continue; }
      const existing = await prisma.user.findUnique({ where: { email } });
      const data = {
        email,
        password: source.password || null,
        fullName: source.fullName || null,
        provider: String(source.provider || 'email').toUpperCase() === 'GOOGLE' ? 'GOOGLE' : 'EMAIL',
        status: String(source.status || 'active').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        role: rawRole.toUpperCase(),
        socialId: source.socialId || null,
        roleId: source.roleId || null,
        customPermissions: source.customPermissions || undefined,
        hash: source.hash || null,
        emailOtpHash: source.emailOtpHash || null,
        emailOtpExpiresAt: source.emailOtpExpiresAt ? new Date(source.emailOtpExpiresAt) : null,
        emailOtpLastSentAt: source.emailOtpLastSentAt ? new Date(source.emailOtpLastSentAt) : null,
        emailOtpAttempts: Number(source.emailOtpAttempts || 0),
        isBlocked: Boolean(source.isBlocked),
        blockedAt: source.blockedAt ? new Date(source.blockedAt) : null,
        isDeleted: Boolean(source.isDeleted),
        lastLoginAt: source.lastLoginAt ? new Date(source.lastLoginAt) : null,
      };
      if (existing) {
        await prisma.user.update({ where: { id: existing.id }, data });
        report.updated += 1;
      } else {
        await prisma.user.create({ data: { ...data, ...(uuidPattern.test(String(source.id || '')) ? { id: source.id } : {}) } });
        report.imported += 1;
      }
    }
  }
  await mongo.close();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
