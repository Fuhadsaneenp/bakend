import { prisma } from "../../lib/prisma.js";
import { storageService } from "../../storage/storage.service.js";
import { ApiError } from "../../lib/errors.js";
import { dayKey, taskStats, evaluate, flagsFor, defaultBands, completionAt, isDone, type Template, type Band } from "./hr-monitoring.engine.js";
export const prefix = "hr_monitoring_v1:";
export function dateRange(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+05:30`);
  const last = new Date(`${to}T00:00:00+05:30`);
  if (!Number.isFinite(+start) || !Number.isFinite(+last) || dayKey(start) !== from || dayKey(last) !== to || last < start || +last - +start > 366 * 86400000) throw new ApiError(400, "Choose a valid date range of up to one year");
  return { from: start, until: new Date(+last + 86400000) };
}
export async function readSetting(companyId: string, key: string) {
  const setting = await prisma.companySetting.findUnique({ where: { companyId_key: { companyId, key: prefix + key } } });
  return { value: setting?.value as any ?? null, version: setting?.updatedAt.toISOString() ?? null };
}
export async function writeSetting(companyId: string, key: string, value: any, version: string | null) {
  const updatedAt = new Date(Math.max(Date.now(), version ? Date.parse(version) + 1 : 0));
  if (version === null) {
    try { await prisma.companySetting.create({ data: { companyId, key: prefix + key, value, updatedAt } }); }
    catch (error: any) { if (error?.code === "P2002") throw new ApiError(409, "This record changed. Refresh before saving."); throw error; }
  } else {
    const result = await prisma.companySetting.updateMany({ where: { companyId, key: prefix + key, updatedAt: new Date(version) }, data: { value, updatedAt } });
    if (!result.count) throw new ApiError(409, "This record changed. Refresh before saving.");
  }
  return { value, version: updatedAt.toISOString() };
}
export async function assertEmployee(companyId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { companyId, id: employeeId }, select: { id: true, departmentId: true, managerId: true } });
  if (!employee) throw new ApiError(404, "Employee not found");
  return employee;
}
export async function collect(companyId: string, from: string, to: string) {
  const range = dateRange(from, to);
  const today = dayKey(new Date());
  const todayRange = dateRange(today, today);
  const [employees, departments, attendance, liveAttendance, cards, settings, offices] = await Promise.all([
    prisma.employee.findMany({ where: { companyId }, select: {
      id: true, employeeCode: true, firstName: true, middleName: true, lastName: true, dateOfJoining: true, status: true, dateOfExit: true, phone: true, city: true, officeId: true,
      user: { select: { email: true, isActive: true } }, department: { select: { id: true, name: true } }, designation: { select: { title: true } },
      documents: { where: { type: "PHOTO", mimeType: { in: ["image/jpeg", "image/png", "image/webp"] } }, select: { fileKey: true }, orderBy: { uploadedAt: "desc" }, take: 1 },
      manager: { select: { id: true, firstName: true, middleName: true, lastName: true } }
    }, orderBy: { firstName: "asc" } }),
    prisma.department.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.attendance.findMany({ where: { employee: { companyId }, workDate: { gte: range.from, lt: range.until } }, orderBy: { workDate: "asc" } }),
    prisma.attendance.findMany({ where: { employee: { companyId }, workDate: { gte: todayRange.from, lt: todayRange.until } } }),
    prisma.workCard.findMany({ where: { companyId, createdAt: { lt: new Date(Math.max(+range.until, +todayRange.until)) } }, select: { id: true, workId: true, title: true, category: true, priority: true, deadline: true, assignedToId: true, status: true, reworkCount: true, createdAt: true, updatedAt: true, client: { select: { id: true, name: true } }, statusHistory: { select: { status: true, createdAt: true, userId: true }, orderBy: { createdAt: "asc" } } } }),
    prisma.companySetting.findMany({ where: { companyId, key: { gte: prefix, lt: "hr_monitoring_v1;" } }, select: { key: true, value: true, updatedAt: true } }),
    prisma.office.findMany({ where: { companyId }, select: { id: true, name: true } })
  ]);
  const values = new Map(settings.map(row => [row.key.slice(prefix.length), row.value as any]));
  const bands: Band[] = values.get("bands") || defaultBands;
  const month = from.slice(0, 7);
  const list = employees.map(employee => {
    const ownCards = cards.filter(card => card.assignedToId === employee.id);
    const logs = attendance.filter(row => row.employeeId === employee.id);
    const live = liveAttendance.find(row => row.employeeId === employee.id);
    const stats = taskStats(ownCards, range.from, range.until);
    const template: Template | null = values.get(`template:${employee.department?.id}`) || null;
    const review = values.get(`review:${employee.id}:${month}`) || null;
    const result = evaluate(template, stats, logs.filter(row => dayKey(row.workDate) < today), values.get(`inputs:${employee.id}:${month}`)?.scores || {}, review, bands);
    const historical = settings.filter(row => row.key.startsWith(`${prefix}snapshot:${employee.id}:`)).map(row => row.value as any).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const flags = flagsFor(stats, logs, result, today);
    const months = new Map<string, any>();
    historical.forEach(snapshot => { if (!months.has(snapshot.month)) months.set(snapshot.month, snapshot); });
    const trend = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
    if (trend.length >= 2 && trend[trend.length - 2].score - trend[trend.length - 1].score >= 10) flags.push("Performance declined by at least 10 points");
    const currentCard = ownCards.find(card => card.status === "IN_PROGRESS");
    const todayLogs = liveAttendance.filter(row => row.employeeId === employee.id);
    const todayTimeline = [
      ...todayLogs.flatMap(row => [row.checkInAt ? { at: row.checkInAt.toISOString(), text: "Checked in", type: "attendance" } : null, row.checkOutAt ? { at: row.checkOutAt.toISOString(), text: "Checked out", type: "attendance" } : null].filter(Boolean)),
      ...ownCards.flatMap(card => card.statusHistory.filter(history => history.createdAt >= todayRange.from && history.createdAt < todayRange.until).map(history => ({ at: history.createdAt.toISOString(), text: `${card.workId} · ${card.title} → ${history.status.replaceAll("_", " ")}`, type: "task" })))
    ].sort((a, b) => a!.at.localeCompare(b!.at));
    const todayLoggedMinutes = todayLogs.reduce((sum, row) => sum + (row.checkInAt && !row.checkOutAt ? Math.max(0, (Date.now() - +row.checkInAt) / 60000) : row.workMinutes), 0);
    const latestEvent = ownCards.flatMap(card => card.statusHistory).sort((a, b) => +b.createdAt - +a.createdAt)[0];
    const loggedMinutes = logs.reduce((sum, row) => sum + (row.checkInAt && !row.checkOutAt && dayKey(row.workDate) === today ? Math.max(0, (Date.now() - +row.checkInAt) / 60000) : row.workMinutes), 0);
    const todayCompleted = ownCards.filter(card => { const at = completionAt(card); return at && dayKey(at) === today; }).length;
    const projects = [...new Map(stats.relevant.map(card => [card.client.id, card.client])).values()].map(project => {
      const part = taskStats(ownCards.filter(card => card.client.id === project.id), range.from, range.until);
      return { ...project, totalTasks: part.assigned, completed: part.completed, pending: part.pending, adherence: part.adherence, workHours: null };
    });
    const timeline = [
      ...logs.flatMap(row => [row.checkInAt ? { at: row.checkInAt.toISOString(), text: "Checked in", type: "attendance" } : null, row.checkOutAt ? { at: row.checkOutAt.toISOString(), text: "Checked out", type: "attendance" } : null].filter(Boolean)),
      ...ownCards.flatMap(card => card.statusHistory.filter(history => history.createdAt >= range.from && history.createdAt < range.until).map(history => ({ at: history.createdAt.toISOString(), text: `${card.workId} · ${card.title} → ${history.status.replaceAll("_", " ")}`, type: "task" })))
    ].sort((a, b) => a!.at.localeCompare(b!.at));
    const reviews = settings.filter(row => row.key.startsWith(`${prefix}review:${employee.id}:`)).map(row => row.value as any).sort((a, b) => b.month.localeCompare(a.month));
    return { id: employee.id, employeeCode: employee.employeeCode, name: [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(" "),
      department: employee.department, designation: employee.designation?.title || "—", manager: employee.manager ? { id: employee.manager.id, name: [employee.manager.firstName, employee.manager.middleName, employee.manager.lastName].filter(Boolean).join(" ") } : null,
      joinedAt: employee.dateOfJoining, employmentStatus: employee.dateOfExit ? "Exited" : employee.status === "ACTIVE" && employee.user.isActive ? "Active" : "Inactive", email: employee.user.email, phone: employee.phone,
      location: offices.find(office => office.id === employee.officeId)?.name || employee.city || null, officeId: employee.officeId, workMode: null, photo: employee.documents[0] ? storageService.publicUrl(employee.documents[0].fileKey) : null,
      status: live?.checkOutAt ? "Checked Out" : live?.checkInAt ? "Working" : "Not Started", checkIn: live?.checkInAt ?? null, checkOut: live?.checkOutAt ?? null,
      loggedMinutes, activeMinutes: null, idleMinutes: null, breakMinutes: null, firstActivity: timeline.find(event => event?.type === "task")?.at || null,
      lastActivity: latestEvent?.createdAt.toISOString() || null, sessionCount: null,
      currentTask: currentCard?.title || null, currentProject: currentCard?.client.name || null, todayCompleted,
      stats: { ...stats, relevant: undefined, finished: undefined }, tasks: stats.relevant.map(card => ({ ...card, completedAt: completionAt(card), overdue: !isDone(card.status) && new Date(card.deadline) < new Date(Math.min(Date.now(), +range.until)) })), projects, attendance: logs, timeline,
      todayAttendance: todayLogs, todayTimeline, todayLoggedMinutes,
      kpi: result, template, flags, snapshots: historical, reviews, inputs: values.get(`inputs:${employee.id}:${month}`)?.scores || {},
      latestPerformance: historical[0] || null
    };
  });
  const departmentsSummary = departments.map(dept => {
    const members = list.filter(employee => employee.department?.id === dept.id);
    const scores = members.map(employee => employee.latestPerformance?.score).filter((score): score is number => typeof score === "number");
    const monthScores = new Map<string, number[]>();
    const targets = members.flatMap(employee => employee.kpi.metrics.filter(metric => metric.calculation === "target_achievement" && metric.value !== null).map(metric => metric.value!));
    const latestMonthly = new Map<string, any>();
    list.flatMap(employee => employee.snapshots).filter(snapshot => snapshot.departmentId === dept.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach(snapshot => {
      const key = `${snapshot.employeeId}:${snapshot.month}`;
      if (!latestMonthly.has(key)) latestMonthly.set(key, snapshot);
    });
    latestMonthly.forEach(snapshot => monthScores.set(snapshot.month, [...(monthScores.get(snapshot.month) || []), snapshot.score]));
    const trend = [...monthScores].map(([month, values]) => ({ month, score: Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100 })).sort((a, b) => a.month.localeCompare(b.month));
    return { ...dept, trend, targetAchievement: targets.length ? Math.round(targets.reduce((a, b) => a + b, 0) / targets.length * 100) / 100 : null, employees: members.length, active: members.filter(employee => employee.employmentStatus === "Active").length,
      averagePerformance: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100 : null,
      averageWorkHours: members.length ? Math.round(members.reduce((sum, employee) => sum + employee.loggedMinutes, 0) / members.length / 60 * 100) / 100 : null,
      completed: members.reduce((sum, employee) => sum + employee.stats.completed, 0), overdue: members.reduce((sum, employee) => sum + employee.stats.overdue, 0), reviewRequired: members.filter(employee => employee.flags.length).length,
      template: values.get(`template:${dept.id}`) || null, templateVersion: settings.find(row => row.key === `${prefix}template:${dept.id}`)?.updatedAt.toISOString() ?? null
    };
  });
  const scores = list.map(employee => employee.latestPerformance?.score).filter((score): score is number => typeof score === "number");
  return { employees: list, departments: departmentsSummary, bands, bandsVersion: settings.find(row => row.key === `${prefix}bands`)?.updatedAt.toISOString() ?? null,
    summary: { total: list.length, working: list.filter(employee => employee.status === "Working").length, notStarted: list.filter(employee => employee.status === "Not Started").length, checkedOut: list.filter(employee => employee.status === "Checked Out").length,
      onBreak: null, activeMinutes: null, completedToday: list.reduce((sum, employee) => sum + employee.todayCompleted, 0), pending: list.reduce((sum, employee) => sum + employee.stats.pending, 0), overdue: list.reduce((sum, employee) => sum + employee.stats.overdue, 0),
      averagePerformance: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100 : null, departments: departments.length, reviewRequired: list.filter(employee => employee.flags.length).length },
    from, to, generatedAt: new Date().toISOString(), capabilities: { attendance: true, tasks: true, projectSource: "Existing WorkCard client/project links", activity: false, onlineStatus: false, activityReason: "The existing tracker provides attendance and task status changes, but does not provide active, idle, break or online telemetry. These values remain unavailable." }
  };
}
