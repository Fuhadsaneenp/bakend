import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

const keyFor = (id: string) => `company_access:${id}`;

export async function allowedCompanyIds(user: { id: string; role: Role; companyId: string | null }): Promise<string[]> {
  if (user.role === Role.SUPER_ADMIN) {
    return (await prisma.company.findMany({ select: { id: true } })).map(c => c.id);
  }
  const setting = await prisma.companySetting.findFirst({ where: { key: keyFor(user.id) } });
  if (setting && Array.isArray(setting.value)) return setting.value.filter((id): id is string => typeof id === "string");
  return user.companyId ? [user.companyId] : [];
}

export async function assertCompanyAccess(user: { id: string; role: Role; companyId: string | null }, companyId: string) {
  if (!(await allowedCompanyIds(user)).includes(companyId)) throw new ApiError(403, "You do not have access to this company");
}

export async function companyAccessDirectory() {
  const [companies, users] = await Promise.all([
    prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, email: true, role: true, companyId: true, employee: { select: { firstName: true, lastName: true, employeeCode: true } } }, orderBy: { email: "asc" } })
  ]);
  const settings = await prisma.companySetting.findMany({ where: { key: { in: users.map(user => keyFor(user.id)) } } });
  return { companies, users: users.map(user => {
    const saved = settings.find(s => s.key === keyFor(user.id));
    return { ...user, companyIds: user.role === Role.SUPER_ADMIN ? companies.map(c => c.id) : saved && Array.isArray(saved.value) ? saved.value : user.companyId ? [user.companyId] : [] };
  }) };
}

export async function saveCompanyAccess(userId: string, companyIds: string[]) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "Employee account not found");
  if (user.role === Role.SUPER_ADMIN) throw new ApiError(400, "Super admins always have access to all companies");
  const ids = [...new Set(companyIds)];
  const companies = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (!ids.length || companies.length !== ids.length) throw new ApiError(400, "Select at least one valid company");
  // Keep one stable storage row per employee; the assignment is separate from their employing company.
  const existing = await prisma.companySetting.findFirst({ where: { key: keyFor(userId) } });
  const storageCompanyId = existing?.companyId || user.companyId || ids[0];
  await prisma.companySetting.upsert({ where: { companyId_key: { companyId: storageCompanyId, key: keyFor(userId) } }, create: { companyId: storageCompanyId, key: keyFor(userId), value: ids }, update: { value: ids } });
  return { companyIds: ids };
}
