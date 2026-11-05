import { prisma } from "../../lib/prisma.js";
import { localDay, sourceIdentity } from "./domain.js";
import { reconcile } from "./service.js";

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Set<string>();
export function scheduleIncentiveSync(companyId: string, month: string) {
  const key = `${companyId}:${month}`;
  if (pending.has(key)) clearTimeout(pending.get(key));
  const timer = setTimeout(async () => {
    pending.delete(key);
    if (running.has(key)) { scheduleIncentiveSync(companyId, month); return; }
    running.add(key);
    try { await reconcile(companyId, month, "system:activity-sync"); }
    catch (e) { console.error("[Productivity incentive] Activity reconciliation failed:", e instanceof Error ? e.message : "Unknown error"); }
    finally { running.delete(key); }
  }, 1000);
  timer.unref(); pending.set(key, timer);
}
export async function captureIncentiveSource(companyId: string, value: any) {
  const sourceKey = sourceIdentity(value); if (!sourceKey) return;
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  if (company?.name.trim().toLowerCase() !== "medbiomate") return;
  const existing = await prisma.incentiveCredit.findUnique({ where: { companyId_sourceKey: { companyId, sourceKey } }, select: { month: true } });
  const date = new Date(value.createdAt);
  if (Number.isFinite(date.getTime())) scheduleIncentiveSync(companyId, localDay(date).slice(0, 7));
  if (existing) scheduleIncentiveSync(companyId, existing.month);
}
