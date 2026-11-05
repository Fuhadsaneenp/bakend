type Leave = { startDate: Date | string; endDate: Date | string; reason: string; status: string; id?: string };
export function isPaidLeave(reason: string) {
  let type = reason.match(/^\s*\[([^\]]+)\]/)?.[1] || "";
  if (!type) { try { type = JSON.parse(reason).type || ""; } catch {} }
  return ["paid leave", "leave"].includes(type.trim().toLowerCase());
}
export const leaveDay = (value: Date | string) => new Date(new Date(value).getTime() + 19800000).toISOString().slice(0, 10);
/** Earliest approved paid-leave date per IST month; duplicate requests share a single day. */
export function paidLeaveDays(requests: Leave[]) {
  const dates = new Set<string>();
  for (const r of requests) {
    if (r.status !== "APPROVED" || !isPaidLeave(r.reason)) continue;
    const first = leaveDay(r.startDate), last = leaveDay(r.endDate);
    for (let time = Date.parse(first); time <= Date.parse(last); time += 86400000) dates.add(new Date(time).toISOString().slice(0, 10));
  }
  const months = new Set<string>(), allowed = new Set<string>();
  for (const day of [...dates].sort()) if (!months.has(day.slice(0, 7))) { months.add(day.slice(0, 7)); allowed.add(day); }
  return allowed;
}
