import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
// @ts-expect-error The shared MCP adapter is JavaScript, copied into dist by the build.
import { createHttpRouter } from '../../mcp/src/http.js';

const issuerUrl = process.env.MCP_PUBLIC_URL || 'https://api.secondtales.com';
const keyFor = (key: string) => `mcp_oauth_v1_${createHash('sha256').update(key).digest('hex')}`;
const store = {
  async get(key: string) {
    const record = await prisma.companySetting.findFirst({ where: { key: keyFor(key) }, select: { value: true } });
    return record?.value || null;
  },
  async set(key: string, value: any) {
    const companyId = value.companyId || (value.userId ? (await prisma.user.findUnique({ where: { id: value.userId }, select: { companyId: true } }))?.companyId : null)
      || (await prisma.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
    if (!companyId) throw new Error('Company context required.');
    await prisma.companySetting.upsert({ where: { companyId_key: { companyId, key: keyFor(key) } },
      create: { companyId, key: keyFor(key), value }, update: { value } });
  },
  async take(key: string) { return (await prisma.companySetting.deleteMany({ where: { key: keyFor(key) } })).count === 1; },
  async delete(key: string) { await prisma.companySetting.deleteMany({ where: { key: keyFor(key) } }); },
};

async function validateUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { employee: { select: { status: true, dateOfExit: true } } } });
  if (!user?.isActive || !user.companyId || !['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'].includes(user.role)
    || (user.employee && (user.employee.status !== 'ACTIVE' || user.employee.dateOfExit))) throw new Error('Reporting account unavailable.');
  return user;
}

export const mcpRouter = createHttpRouter({
  issuerUrl,
  baseUrl: `http://127.0.0.1:${env.PORT}`,
  store,
  validateUser,
  async authenticate(identifier: string, password: string) {
    const normalized = identifier.trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { OR: [{ email: normalized }, { employee: { employeeCode: identifier.trim().toUpperCase() } }] } });
    if (!user || !await bcrypt.compare(password, user.passwordHash)) throw new Error('Invalid credentials.');
    return validateUser(user.id);
  },
  async getBackendToken(userId: string) {
    const user = await validateUser(userId);
    // Separate audience-bound opaque MCP tokens never pass through to the backend.
    // This short-lived internal token reuses the existing API authorization checks.
    return jwt.sign({ id: user.id, companyId: user.companyId, role: user.role, email: user.email }, env.JWT_ACCESS_SECRET, { expiresIn: '2m' });
  },
});
