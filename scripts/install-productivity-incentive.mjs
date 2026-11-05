// Additive, idempotent installation. Load the deployment's private environment first.
import { readFile } from 'node:fs/promises';
const { prisma } = await import('../dist/src/lib/prisma.js');
try {
  const sql = await readFile(new URL('../prisma/migrations/20261105093000_productivity_incentive/migration.sql', import.meta.url), 'utf8');
  for (const part of sql.split(';').map(s => s.replace(/^--.*$/gm, '').trim()).filter(Boolean)) {
    if (!/^CREATE TABLE `(IncentivePolicy|IncentiveCredit|IncentiveAudit)`/.test(part)) throw Error('Unexpected non-additive incentive migration');
    await prisma.$executeRawUnsafe(part.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'));
  }
  for (const table of ['IncentivePolicy', 'IncentiveCredit', 'IncentiveAudit']) await prisma.$queryRawUnsafe(`SELECT id FROM \`${table}\` LIMIT 0`);
  console.log('Installed the three isolated incentive tables. Existing business tables were not altered.');
} finally { await prisma.$disconnect(); }
