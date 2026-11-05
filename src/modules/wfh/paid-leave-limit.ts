import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { isPaidLeave, leaveDay } from "../../lib/paidLeave.js";
import mariadb from "mariadb";
import { env } from "../../config/env.js";

// Connection-bound advisory lock serializes existing request/review code across workers.
// The workflow's normal writes remain committed before the lock is released.
export async function withPaidLeaveLock<T>(employeeId: string, work: () => Promise<T>): Promise<T> {
  const url = new URL(env.DATABASE_URL);
  const connection = await mariadb.createConnection({ host: url.hostname === "srv1824.hstgr.io" ? "193.203.184.196" : url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1), connectTimeout: 10000 });
  const key = `stems:paid-leave:${employeeId}`;
  try {
    const result = await connection.query("SELECT GET_LOCK(?, 10) AS held", [key]);
    if (Number(result[0]?.held) !== 1) throw new ApiError(409, "Another paid-leave request is being processed. Please retry.");
    try { return await work(); } finally { await connection.query("SELECT RELEASE_LOCK(?)", [key]); }
  } finally { await connection.end(); }
}

export async function assertPaidLeaveLimit(employeeId: string, data: { startDate: Date | string; endDate: Date | string }, approval = false, excludeId?: string) {
  if (!Number.isFinite(new Date(data.startDate).getTime()) || !Number.isFinite(new Date(data.endDate).getTime()) || new Date(data.endDate) < new Date(data.startDate)) throw new ApiError(400, "Invalid paid-leave date range");
  const first = leaveDay(data.startDate), last = leaveDay(data.endDate);
  if (first !== last) throw new ApiError(400, "Only one day of Paid Leave is allowed per calendar month. Apply additional days as Unpaid Leave.");
  const month = first.slice(0, 7), start = new Date(`${month}-01T00:00:00+05:30`);
  const [year, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, m, 1) - 19800000);
  const requests = await prisma.wFHRequest.findMany({ where: { employeeId, ...(excludeId ? { id: { not: excludeId } } : {}), status: approval ? "APPROVED" : { not: "REJECTED" }, startDate: { lt: end }, endDate: { gte: start } }, select: { reason: true } });
  if (requests.some(r => isPaidLeave(r.reason))) throw new ApiError(400, "This employee already has a paid-leave day in this calendar month. Additional leave must be Unpaid Leave.");
}
