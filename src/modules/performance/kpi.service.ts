import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

export const DEFAULT_WEIGHTS = { attendance: 15, activeWork: 15, output: 30, quality: 20, efficiency: 10, reliability: 10 };
export const DEFAULT_LEVELS = [
  { name: "Excellent", min: 90, max: 100 }, { name: "Very Good", min: 80, max: 89.99 },
  { name: "Good", min: 70, max: 79.99 }, { name: "Needs Improvement", min: 60, max: 69.99 }, { name: "Poor", min: 0, max: 59.99 }
];
export const DEFAULT_WORK_UNIT_RULES = [
  { taskType: "Data Entry", quantity: 15, workUnits: 1 },
  { taskType: "Graphic Design", quantity: 1, workUnits: 1 },
  { taskType: "Design", quantity: 1, workUnits: 1 },
  { taskType: "Video Editing", quantity: 1, workUnits: 2 },
  { taskType: "Poster", quantity: 1, workUnits: 1 },
  { taskType: "Logo", quantity: 1, workUnits: 1 },
  { taskType: "Brochure", quantity: 1, workUnits: 1 },
  { taskType: "Ad campaign", quantity: 1, workUnits: 1 },
  { taskType: "Reel", quantity: 1, workUnits: 2 },
  { taskType: "Video", quantity: 1, workUnits: 2 },
  { taskType: "Blog Article", quantity: 1, workUnits: 1.5 },
  { taskType: "Landing Page", quantity: 1, workUnits: 3 }
];
const round = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function periodRange(period: string, now = new Date()) {
  const today = day(now);
  if (period === "today") return { period: "DAILY", start: today, end: now };
  if (period === "yesterday") { const start = new Date(+today - 86400000); return { period: "DAILY", start, end: new Date(+today - 1) }; }
  if (period === "this_week" || period === "last_week") {
    const mondayOffset = (today.getDay() + 6) % 7;
    const start = new Date(+today - (mondayOffset + (period === "last_week" ? 7 : 0)) * 86400000);
    const fullEnd = new Date(+start + 7 * 86400000 - 1);
    const end = period === "this_week" ? new Date(Math.min(+fullEnd, +now)) : fullEnd;
    return { period: "WEEKLY", start, end };
  }
  if (period === "last_month") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { period: "MONTHLY", start, end: new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999) };
  }
  if (period === "this_month") return { period: "MONTHLY", start: new Date(today.getFullYear(), today.getMonth(), 1), end: now };
  throw new ApiError(400, "Unsupported KPI period");
}

function currentShiftFraction(now: Date, startTime?: string, endTime?: string) {
  const [startHour, startMinute] = (startTime || "09:00").split(":").map(Number);
  const [endHour, endMinute] = (endTime || "18:00").split(":").map(Number);
  const start = new Date(now); start.setHours(startHour || 0, startMinute || 0, 0, 0);
  const end = new Date(now); end.setHours(endHour || 0, endMinute || 0, 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1);
  return clamp((+now - +start) / (+end - +start), 0, 1);
}

function workingDays(start: Date, end: Date, workSevenDays: boolean, scheduleDays?: string) {
  let configuredDays: number[] | undefined;
  try { if (scheduleDays) configuredDays = JSON.parse(scheduleDays).map((v: string | number) => typeof v === "number" ? v : ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].indexOf(String(v).toLowerCase())); } catch { configuredDays = undefined; }
  let count = 0;
  for (let d = day(start); d <= end; d = new Date(+d + 86400000)) if (configuredDays ? configuredDays.includes(d.getDay()) : workSevenDays || (d.getDay() !== 0 && d.getDay() !== 6)) count++;
  return count;
}

async function config(companyId: string) {
  let c = await prisma.kpiConfiguration.findUnique({ where: { companyId }, include: { rules: true, targets: true } });
  if (!c) {
    try { c = await prisma.kpiConfiguration.create({ data: { companyId, weights: DEFAULT_WEIGHTS, levels: DEFAULT_LEVELS, ruleDefaultsVersion: 1, rules: { create: DEFAULT_WORK_UNIT_RULES } }, include: { rules: true, targets: true } }); }
    catch (error: any) { if (error.code !== "P2002") throw error; c = await prisma.kpiConfiguration.findUnique({ where: { companyId }, include: { rules: true, targets: true } }); }
  }
  else if (c.ruleDefaultsVersion < 1) {
    for (const rule of DEFAULT_WORK_UNIT_RULES) await prisma.kpiWorkUnitRule.upsert({
      where: { configurationId_taskType: { configurationId: c.id, taskType: rule.taskType } },
      create: { configurationId: c.id, ...rule },
      update: {}
    });
    await prisma.kpiConfiguration.update({ where: { companyId }, data: { ruleDefaultsVersion: 1 } });
    c = await prisma.kpiConfiguration.findUnique({ where: { companyId }, include: { rules: true, targets: true } })!;
  }
  if (!c) throw new ApiError(500, "Unable to load KPI configuration");
  return c;
}

function unitFor(card: any, rules: any[]) {
  const type = String(card.category || "").trim().toLowerCase();
  const rule = rules.find((r) => r.taskType.toLowerCase() === type);
  const complexity = { SIMPLE: 1, MEDIUM: 1.5, HEAVY: 2 }[card.complexity as "SIMPLE" | "MEDIUM" | "HEAVY"] || 1;
  if (rule) return Number(rule.workUnits) * Number(card.workQuantity || 1) / Number(rule.quantity) * complexity;
  return Number(card.workQuantity || 1) * complexity;
}

async function scoreEmployee(companyId: string, employeeId: string, start: Date, end: Date) {
  const [employee, c, company, attendance, activities, cards, assignedCards, approvedLeaves, approvedWfhRequests] = await Promise.all([
    prisma.employee.findFirst({ where: { id: employeeId, companyId, status: "ACTIVE" }, include: { department: true, designation: true, shift: true, manager: { select: { id: true } } } }),
    config(companyId),
    prisma.company.findUnique({ where: { id: companyId }, select: { worksSevenDays: true } }),
    prisma.attendance.findMany({ where: { employeeId, workDate: { gte: start, lte: end } } }),
    prisma.kpiActivity.findMany({ where: { employeeId, workDate: { gte: start, lte: end } } }),
    prisma.workCard.findMany({ where: { companyId, assignedToId: employeeId, status: "APPROVED", OR: [{ completedAt: { gte: start, lte: end } }, { completedAt: null, statusHistory: { some: { status: "APPROVED", createdAt: { gte: start, lte: end } } } }] }, include: { ratings: true, reworkLogs: true, statusHistory: { where: { status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 1 } } }),
    prisma.workCard.findMany({ where: { companyId, assignedToId: employeeId, deadline: { lte: end }, OR: [{ deadline: { gte: start } }, { status: { not: "APPROVED" } }] }, select: { id: true, status: true, deadline: true, completedAt: true, statusHistory: { where: { status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 1 } } }),
    prisma.kpiLeave.findMany({ where: { companyId, employeeId, status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } } }),
    prisma.wFHRequest.findMany({ where: { employeeId, status: "APPROVED", startDate: { lte: end }, endDate: { gte: start } }, select: { startDate: true, endDate: true } })
  ]);
  if (!employee) throw new ApiError(404, "Employee not found");
  const weights = { ...DEFAULT_WEIGHTS, ...(c.weights as any) };
  const sumWeights = Object.values(weights).reduce((s: number, v: any) => s + Number(v), 0);
  if (Math.abs(sumWeights - 100) > 0.01) throw new ApiError(422, "KPI weights must add up to 100");
  const days = workingDays(start, end, !!company?.worksSevenDays, employee.shift?.workingDays);
  const shiftMinutes = Number(employee.shift?.workMinutesFix || (Number(employee.customFullDayHours || 8) * 60));
  const target = c.targets.find((t: any) => t.scope === "EMPLOYEE" && t.scopeId === employeeId)
    || c.targets.find((t: any) => t.scope === "DESIGNATION" && t.scopeId === employee.designationId)
    || c.targets.find((t: any) => t.scope === "DEPARTMENT" && t.scopeId === employee.departmentId)
    || c.targets.find((t: any) => t.scope === "COMPANY");
  const eligibleWfhDates = new Set<number>();
  for (const request of approvedWfhRequests) {
    const from = Math.max(+day(request.startDate), +day(start)); const to = Math.min(+day(request.endDate), +day(end));
    for (let d = from; d <= to; d += 86400000) if (workingDays(new Date(d), new Date(d), !!company?.worksSevenDays, employee.shift?.workingDays)) eligibleWfhDates.add(d);
  }
  const approvedWfh = eligibleWfhDates.size;
  const approvedLeaveDays = approvedLeaves.reduce((count: number, leave: any) => {
    const from = Math.max(+day(leave.startDate), +day(start)); const to = Math.min(+day(leave.endDate), +day(end));
    let span = 0;
    for (let d = from; d <= to; d += 86400000) if (workingDays(new Date(d), new Date(d), !!company?.worksSevenDays, employee.shift?.workingDays)) span++;
    return count + span * (leave.halfDay ? 0.5 : 1);
  }, 0);
  const rangeNow = new Date();
  const todayStart = +day(rangeNow);
  const todayInRange = todayStart >= +day(start) && todayStart <= +day(end) && workingDays(day(rangeNow), day(rangeNow), !!company?.worksSevenDays, employee.shift?.workingDays) > 0;
  const fraction = todayInRange ? currentShiftFraction(rangeNow, employee.shift?.startTime, employee.shift?.endTime) : 0;
  const effectiveExpectedDays = Math.max(0, days - (todayInRange ? 1 : 0) + fraction - Math.min(days, approvedLeaveDays));
  const leaveDateKeys = new Set<number>();
  for (const leave of approvedLeaves) if (!leave.halfDay) for (let d = Math.max(+day(leave.startDate), +day(start)); d <= Math.min(+day(leave.endDate), +day(end)); d += 86400000) leaveDateKeys.add(d);
  const attendanceDates = new Set(attendance.filter((a: any) => !leaveDateKeys.has(+day(a.workDate))).map((a: any) => +day(a.workDate)));
  const eligibleDates = new Set([...attendanceDates, ...eligibleWfhDates].filter((date) => !leaveDateKeys.has(date)));
  const eligibleDays = Math.min(effectiveExpectedDays, eligibleDates.size);
  const targetUnits = Number(target?.dailyWorkUnits || 4) * effectiveExpectedDays;
  const expectedMinutes = Number(target?.expectedMinutes || shiftMinutes) * effectiveExpectedDays;
  const lateDays = attendance.filter((a: any) => a.isLate && !leaveDateKeys.has(+day(a.workDate))).length;
  const earlyDays = attendance.filter((a: any) => a.isEarlyLeave && !leaveDateKeys.has(+day(a.workDate))).length;
  const unapprovedAbsent = Math.max(0, effectiveExpectedDays - eligibleDays);
  const attendanceScore = effectiveExpectedDays ? clamp(eligibleDays / effectiveExpectedDays * 100 - lateDays * 2 - earlyDays * 2) : 100;
  const activeMinutes = activities.reduce((s: number, a: any) => s + a.activeMinutes, 0);
  const idleMinutes = activities.reduce((s: number, a: any) => s + a.idleMinutes, 0);
  const breakMinutes = activities.reduce((s: number, a: any) => s + a.breakMinutes, 0);
  const activeScore = activities.length && expectedMinutes ? clamp(activeMinutes / expectedMinutes * 100) : null;
  const dataEntryRule = c.rules.find((rule: any) => rule.taskType.toLowerCase() === "data entry");
  const dataEntryCards = cards.filter((card: any) => String(card.category).toLowerCase() === "data entry");
  const approvedCardUnits = cards.reduce((s: number, card: any) => s + unitFor(card, c.rules), 0);
  const dataEntryUnits = dataEntryCards.length ? 0 : activities.reduce((s: number, activity: any) => s + activity.validEntries * Number(dataEntryRule?.workUnits || 1) / Number(dataEntryRule?.quantity || 15), 0);
  const workUnits = approvedCardUnits + dataEntryUnits;
  const outputScore = clamp(targetUnits ? workUnits / targetUnits * 100 : 0, 0, Number(c.maxOutputScore));
  const ratings = cards.flatMap((card: any) => card.ratings.map((r: any) => Number(r.rating)));
  const ratingQuality = ratings.length ? ratings.reduce((s: number, r: number) => s + clamp(r * 20), 0) / ratings.length : 100;
  const activityTotal = activities.reduce((s: number, a: any) => s + a.validEntries + a.incorrectEntries + a.duplicateEntries + a.rejectedItems, 0);
  const validTotal = activities.reduce((s: number, a: any) => s + a.validEntries, 0);
  const entryAccuracy = activityTotal ? validTotal / activityTotal * 100 : null;
  const reworkCount = cards.reduce((s: number, card: any) => s + Math.max(card.reworkCount || 0, card.reworkLogs.length), 0);
  const qualityParts = [ratings.length ? { score: ratingQuality, weight: 0.6 } : cards.length ? { score: 100, weight: 0.6 } : null, entryAccuracy !== null ? { score: entryAccuracy, weight: 0.4 } : null].filter(Boolean) as { score: number; weight: number }[];
  const qualityScore = qualityParts.length
    ? clamp(qualityParts.reduce((sum, part) => sum + part.score * part.weight, 0) / qualityParts.reduce((sum, part) => sum + part.weight, 0) - reworkCount * 3)
    : reworkCount > 0 ? clamp(100 - reworkCount * 3) : null;
  const minActive = Number(c.minimumActiveRatio || 0.6);
  const efficiencyScore = !activities.length ? null : activeMinutes >= expectedMinutes * minActive && activeMinutes > 0 ? clamp((workUnits / (activeMinutes / 60)) / Math.max(0.01, targetUnits / (expectedMinutes / 60)) * 100) : 0;
  const lateTasks = assignedCards.filter((card: any) => {
    const approvedAt = card.completedAt || card.statusHistory[0]?.createdAt;
    return card.status === "APPROVED" ? Boolean(approvedAt && approvedAt > card.deadline) : true;
  }).length;
  const overdueShare = assignedCards.length ? lateTasks / assignedCards.length : 0;
  const reliabilityScore = clamp(100 - overdueShare * 60 - unapprovedAbsent * 5);
  const scores = { attendance: round(attendanceScore), activeWork: activeScore === null ? null : round(activeScore), output: round(outputScore), quality: qualityScore === null ? null : round(qualityScore), efficiency: efficiencyScore === null ? null : round(efficiencyScore), reliability: round(reliabilityScore) };
  const availableWeight = Object.entries(weights).reduce((s, [k, w]) => s + (scores[k as keyof typeof scores] === null ? 0 : Number(w)), 0);
  const finalKpiScore = round(clamp(Object.entries(weights).reduce((s, [k, w]) => { const score = scores[k as keyof typeof scores]; return s + (score === null ? 0 : score * Number(w)); }, 0) / Math.max(1, availableWeight)));
  const level = (c.levels as any[]).find((l) => finalKpiScore >= Number(l.min) && finalKpiScore <= Number(l.max))?.name || "Unrated";
  return {
    employee: { id: employee.id, name: `${employee.firstName} ${employee.lastName}`.trim(), employeeCode: employee.employeeCode, department: employee.department?.name, designation: employee.designation?.title },
    period: { start, end }, ...scores, weights, finalKpiScore, level, workUnits: round(workUnits),
      breakdown: { expectedWorkingDays: round(effectiveExpectedDays), scheduledWorkingDays: days, approvedLeaveDays, approvedWfhDays: approvedWfh, attendanceDays: eligibleDays, lateDays, earlyExitDays: earlyDays, unapprovedAbsenceDays: unapprovedAbsent,
      expectedMinutes: round(expectedMinutes), activeMinutes, idleMinutes, breakMinutes, activityEvidenceDays: activities.length, activityMeasurement: activities.length ? "measured STEMS activity" : "no activity measurements submitted", scoreCoverageWeight: availableWeight,
      output: { actualWorkUnits: round(workUnits), approvedCardWorkUnits: round(approvedCardUnits), validDataEntryWorkUnits: round(dataEntryUnits), dataEntrySource: dataEntryCards.length ? "approved data-entry cards" : "measured valid entries", expectedWorkUnits: round(targetUnits), maxScore: c.maxOutputScore }, quality: { cards: cards.length, ratingsCount: ratings.length, averageRating: ratings.length ? round(ratings.reduce((a: number,b:number)=>a+b,0)/ratings.length) : null, entryAccuracy: entryAccuracy === null ? null : round(entryAccuracy), reworkCount }, reliability: { assignedTasks: assignedCards.length, overdueTasks: lateTasks }, efficiencyMinimumActiveRatio: minActive, targetScope: target?.scope || "DEFAULT" }
  };
}

export const kpiService = {
  async getConfiguration(companyId: string) { return config(companyId); },
  async updateConfiguration(companyId: string, input: any) {
    const current = await config(companyId);
    const weights = input.weights ?? current.weights;
    if (Object.values(weights).some((x: any) => Number(x) < 0) || Math.abs(Object.values(weights).reduce((s: number, x: any) => s + Number(x), 0) - 100) > 0.01) throw new ApiError(400, "Weights must be non-negative and total 100");
    return prisma.$transaction(async (tx: any) => {
      await tx.kpiConfiguration.update({ where: { companyId }, data: { weights, levels: input.levels ?? current.levels, maxOutputScore: input.maxOutputScore ?? current.maxOutputScore, minimumActiveRatio: input.minimumActiveRatio ?? current.minimumActiveRatio } });
      if (input.rules) {
        await tx.kpiWorkUnitRule.deleteMany({ where: { configurationId: current.id } });
        for (const r of input.rules) await tx.kpiWorkUnitRule.create({ data: { configurationId: current.id, ...r } });
      }
      if (input.targets) {
        await tx.kpiTarget.deleteMany({ where: { configurationId: current.id } });
        for (const t of input.targets) await tx.kpiTarget.create({ data: { configurationId: current.id, ...t } });
      }
      return tx.kpiConfiguration.findUnique({ where: { companyId }, include: { rules: true, targets: true } });
    });
  },
  async getEmployee(companyId: string, employeeId: string, period = "this_month") {
    const range = periodRange(period);
    return scoreEmployee(companyId, employeeId, range.start, range.end);
  },
  async getCollection(companyId: string, period = "this_month", filter: any = {}) {
    const range = periodRange(period);
    const managerId = filter.managerId;
    const employees = await prisma.employee.findMany({ where: { companyId, status: "ACTIVE", ...(filter.departmentId ? { departmentId: filter.departmentId } : {}), ...(managerId ? { OR: [{ managerId }, { id: managerId }] } : {}), ...(filter.teamId ? { teamMemberships: { some: { teamId: filter.teamId } } } : {}) }, select: { id: true } });
    const results = await Promise.all(employees.map((e: any) => scoreEmployee(companyId, e.id, range.start, range.end)));
    return results.sort((a, b) => b.finalKpiScore - a.finalKpiScore);
  },
  async snapshot(companyId: string, period: "DAILY" | "WEEKLY" | "MONTHLY", start: Date, end: Date) {
    const employees = await prisma.employee.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true } });
    const values = await Promise.all(employees.map((e: any) => scoreEmployee(companyId, e.id, start, end)));
    const rows = [];
    for (const v of values) rows.push(await prisma.employeeKpiSnapshot.upsert({ where: { employeeId_period_periodStart: { employeeId: v.employee.id, period, periodStart: start } }, create: { companyId, employeeId: v.employee.id, period, periodStart: start, periodEnd: end, attendanceScore: v.attendance, activeWorkScore: v.activeWork, outputScore: v.output, qualityScore: v.quality, efficiencyScore: v.efficiency, reliabilityScore: v.reliability, workUnits: v.workUnits, finalKpiScore: v.finalKpiScore, breakdown: v.breakdown }, update: { periodEnd: end, attendanceScore: v.attendance, activeWorkScore: v.activeWork, outputScore: v.output, qualityScore: v.quality, efficiencyScore: v.efficiency, reliabilityScore: v.reliability, workUnits: v.workUnits, finalKpiScore: v.finalKpiScore, breakdown: v.breakdown } }));
    return rows;
  },
  async activity(companyId: string, employeeId: string, date: Date, data: any) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId, status: "ACTIVE" }, select: { id: true } });
    if (!employee) throw new ApiError(404, "Employee not found");
    const workDate = day(date);
    return prisma.kpiActivity.upsert({ where: { employeeId_workDate: { employeeId, workDate } }, create: { companyId, employeeId, workDate, ...data }, update: data });
  }
};
