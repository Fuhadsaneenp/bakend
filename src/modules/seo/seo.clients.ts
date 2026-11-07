import { prisma } from "../../lib/prisma.js";

export function crmSeoClientNames(value: unknown): Set<string> {
  const clients = (value as { clients?: unknown[] } | null)?.clients;
  if (!Array.isArray(clients)) return new Set();
  return new Set(clients.filter((entry: any) => {
    const services = Array.isArray(entry?.services) ? entry.services : [];
    return services.some((service: unknown) => typeof service === "string" && /\bseo\b|search engine optimi[sz]ation/i.test(service));
  }).map((entry: any) => String(entry.company || entry.name || "").trim().toLowerCase()).filter(Boolean));
}

export async function provisionSeoCrmClients(companyId: string) {
  await prisma.$transaction(async tx => {
    const setting = await tx.companySetting.findUnique({
      where: { companyId_key: { companyId, key: "crm_shared_workspace_data_v1" } },
      select: { value: true },
    });
    const names = crmSeoClientNames(setting?.value);
    const entries = (setting?.value as { clients?: { company?: string; name?: string; status?: string }[] } | undefined)?.clients;
    if (!Array.isArray(entries) || !names.size) return;
    const existing = await tx.client.findMany({ where: { companyId }, select: { name: true } });
    const known = new Set(existing.map(client => client.name.trim().toLowerCase()));
    const missing = [];
    for (const entry of entries) {
      const name = String(entry?.company || entry?.name || "").trim();
      const key = name.toLowerCase();
      if (entry?.status === "Lost" || !names.has(key) || known.has(key)) continue;
      known.add(key);
      missing.push({ companyId, name, packageName: "SEO" });
    }
    if (missing.length) await tx.client.createMany({ data: missing });
  }, { isolationLevel: "Serializable" });
}

export async function seoCrmClients(companyId: string) {
  // Read the stored CRM source directly; reading SEO must never seed CRM defaults.
  const setting = await prisma.companySetting.findUnique({
    where: { companyId_key: { companyId, key: "crm_shared_workspace_data_v1" } },
    select: { value: true },
  });
  const names = crmSeoClientNames(setting?.value);
  const clients = await prisma.client.findMany({
    where: { companyId }, select: { id: true, name: true }, orderBy: { name: "asc" },
  });
  return clients.filter(client => names.has(client.name.trim().toLowerCase()));
}

export async function isSeoCrmClient(companyId: string, name: string) {
  const setting = await prisma.companySetting.findUnique({
    where: { companyId_key: { companyId, key: "crm_shared_workspace_data_v1" } },
    select: { value: true },
  });
  return crmSeoClientNames(setting?.value).has(name.trim().toLowerCase());
}
