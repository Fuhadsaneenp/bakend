import { matchEmployeeMention } from "./employee-name.service.js";
import { getShiftParams, getShiftTime } from "../attendance/attendance.service.js";
import { identifyReadOnlyQuery } from "./query-intent.service.js";
import { workloadRulesSchema, taskWeight } from "./workload-rules.js";
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { employedDuring, calendarDate } from '../../lib/employment.js';
import type { UserContext } from './ai.types.js';
import { planQuestion, previousPeriod, type QueryPlan } from './verified-query.js';

const fullName = (employee: any) => [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' ');
export async function authorizedEmployeeWhere(user: UserContext): Promise<any> {
  if (!user.companyId) throw new ApiError(403, 'Select an authorized company before requesting analytics');
  const base = { companyId: user.companyId };
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role)) return base;
  if (!user.employeeId) throw new ApiError(403, 'Employee profile required');
  // A role name alone never grants company-wide access. Include explicit team leadership only.
  const teams = await prisma.team.findMany({ where: { companyId: user.companyId, leadEmployeeId: user.employeeId, isActive: true }, select: { members: { select: { employeeId: true } } } });
  const ids = [user.employeeId, ...teams.flatMap(team => team.members.map(member => member.employeeId))];
  return { ...base, OR: [{ id: { in: ids } }, ...(user.role === 'MANAGER' ? [{ managerId: user.employeeId }] : [])] };
}
const employeeSelect = { id: true, userId: true, employeeCode: true, firstName: true, middleName: true, lastName: true, dateOfJoining: true, dateOfExit: true, exitReason: true, status: true, department: { select: { name: true } }, designation: { select: { title: true } }, shift: { select: { startTime:true,endTime:true,gracePeriod:true,earlyPunchTolerance:true,workMinutesFix:true } } } as const;
const limit = 10001;
function checkLimit<T>(rows: T[]) { if (rows.length >= limit) throw new ApiError(400, 'Too many source records; choose a shorter period or specific employee'); return rows; }
export type AttendanceEvent = { date:string; workMinutes:number; checkInAt:string|null; checkOutAt:string|null; scheduledStart:string; scheduledEnd:string; earlyDepartureMinutes:number|null; isEarlyLeave:boolean; graceMinutes:number; lateMinutes:number|null; earlyArrivalMinutes:number|null; minutesAfterGrace:number|null; isLate:boolean; scheduleBasis:'assigned_shift'|'attendance_default_policy' };
export type VerifiedReport = { plan: QueryPlan; sourceTimestamp: string; timezone: string; employees: { id: string; name: string; code: string; department: string; exitReason: string | null; dateOfExit: Date | null }[]; rows: { employeeId: string; name: string; value: number; unit: string; details?: string; attendanceEvents?: AttendanceEvent[]; workSummary?: {completed:number;pending:number;inProgress:number;approval:number}; workItems?: {title:string;clientName?:string;overdueMinutes?:number;deadline:string;status:string|null}[] }[]; gaps: string[]; totals: Record<string, number>; attendanceGroups?: { checkedIn: string[]; approvedWfh: string[]; approvedLeave: string[]; noAttendanceRecord: string[]; wfhCheckedIn: string[] }; comparison?: VerifiedReport; sources: string[] };
function bounds(plan: QueryPlan) { return { start: new Date(`${plan.start}T00:00:00+05:30`), end: new Date(`${plan.end}T23:59:59.999+05:30`) }; }
export async function runVerifiedReport(user: UserContext, plan: QueryPlan): Promise<VerifiedReport> {
  const where = await authorizedEmployeeWhere(user);
  let employees = checkLimit(await prisma.employee.findMany({ where, select: employeeSelect, take: limit }));
  const explicitPerson=plan.employee&&!/^(me|my|our|the|team|work|today|employees|designers|attendance)$/i.test(plan.employee);
  if(!/^(me|my)$/i.test(plan.employee||'')) {
    let matched=matchEmployeeMention(plan.currentQuestion,employees);
    if(!matched.matches.length&&explicitPerson)matched=matchEmployeeMention(plan.employee!,employees);
    if(!matched.matches.length&&plan.subjectText!==plan.currentQuestion)matched=matchEmployeeMention(plan.subjectText,employees);
    if(matched.ambiguous)throw new ApiError(400,`Several authorized employees match. Please use employee code: ${matched.matches.map(person=>person.employeeCode).join(', ')}`);
    if(matched.matches.length)employees=matched.matches;
    else if(explicitPerson || /what did|hours did|performance of/i.test(plan.currentQuestion))throw new ApiError(404,'No authorized employee matched. Please use the full name or employee code.');
  }
  if (/^(me|my)$/i.test(plan.employee || '')) employees = employees.filter(employee => employee.id === user.employeeId);
  if (plan.department) employees = employees.filter(employee => `${employee.department?.name || ''} ${employee.designation?.title || ''}`.toLowerCase().includes(plan.department!.replace(' editing', '')));
  // Historical overlap, never today's status, determines the report roster.
  employees = employees.filter(employee => employedDuring(employee, plan.start, plan.end));
  const ids = employees.map(employee => employee.id); const times = bounds(plan);
  const asOf = new Date(Math.min(times.end.getTime(), Date.now()));
  const report: VerifiedReport = { plan, sourceTimestamp: new Date().toISOString(), timezone: 'Asia/Kolkata', employees: employees.map(employee => ({ id: employee.id, name: fullName(employee), code: employee.employeeCode, department: employee.department?.name || 'Unassigned', exitReason: employee.exitReason, dateOfExit: employee.dateOfExit })), rows: [], gaps: [], totals: {}, sources: [] };
  const name = (id: string) => report.employees.find(employee => employee.id === id)?.name || 'Unassigned';
  const addGap = (gap: string) => { if (!report.gaps.includes(gap)) report.gaps.push(gap); };
  const rawRules = await prisma.companySetting.findUnique({ where: { companyId_key: { companyId: user.companyId!, key: 'ai_workload_rules_v1' } }, select: { value: true, updatedAt: true } });
  const parsedRules = workloadRulesSchema.safeParse(rawRules?.value);
  const rules = parsedRules.success ? parsedRules.data : undefined;
  if (rawRules && !rules) addGap('Configured workload rules are invalid or unapproved; normalized workload was not calculated.');

  if (['attendance', 'overview'].includes(plan.kind)) {
    const [attendance, requests] = await Promise.all([
      prisma.attendance.findMany({ where: { employeeId: { in: ids }, workDate: { gte: times.start, lte: times.end } }, select: { employeeId: true, workDate: true, checkInAt: true, checkOutAt: true, workMinutes: true, isLate: true, isEarlyLeave: true }, take: limit }),
      prisma.wFHRequest.findMany({ where: { employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: times.end }, endDate: { gte: times.start } }, select: { employeeId: true, startDate: true, endDate: true, reason: true }, take: limit })
    ]); checkLimit(attendance); checkLimit(requests); report.sources.push('Attendance', 'WFHRequest');
    const present = new Set(attendance.filter(record => record.checkInAt).map(record => record.employeeId));
    const wfh = new Set(requests.filter(request => /\[.*(?:WFH|work from home).*\]/i.test(request.reason)).map(request => request.employeeId));
    const leave = new Set(requests.filter(request => /\[.*leave.*\]/i.test(request.reason)).map(request => request.employeeId));
    const namesFor = (group: Set<string>) => employees.filter(employee=>group.has(employee.id)).map(fullName);
    const wfhCheckedIn=new Set([...wfh].filter(id=>present.has(id)));
    const missing=new Set(ids.filter(id=>!present.has(id)&&!leave.has(id)));
    report.attendanceGroups={checkedIn:namesFor(present),approvedWfh:namesFor(wfh),approvedLeave:namesFor(leave),noAttendanceRecord:namesFor(missing),wfhCheckedIn:namesFor(wfhCheckedIn)};
    report.totals = { wfhCheckedIn:wfhCheckedIn.size, employees: employees.length, checkedIn: present.size, approvedWfh: wfh.size, approvedLeave: leave.size, noAttendanceRecord: ids.filter(id => !present.has(id) && !leave.has(id)).length, lateRecords: attendance.filter(record => record.isLate).length, earlyDepartureRecords: attendance.filter(record => record.isEarlyLeave).length, missingCheckouts: attendance.filter(record => record.checkInAt && !record.checkOutAt).length };
    for (const employee of employees) {
      const records = attendance.filter(record => record.employeeId === employee.id);
      const shift=getShiftParams(employee);
      const attendanceEvents:AttendanceEvent[]=records.map(record=>{
        const expected=getShiftTime(record.workDate,shift.startTime);
        let expectedEnd=getShiftTime(record.workDate,shift.endTime);
        if(expectedEnd<expected)expectedEnd=new Date(expectedEnd.getTime()+86400000);
        const minutes=record.checkInAt && Number.isFinite(expected.getTime())?Math.max(0,Math.floor((record.checkInAt.getTime()-expected.getTime())/60000)):null;
        return {date:calendarDate(record.workDate),workMinutes:record.workMinutes,checkInAt:record.checkInAt?.toISOString()||null,checkOutAt:record.checkOutAt?.toISOString()||null,scheduledStart:expected.toISOString(),scheduledEnd:expectedEnd.toISOString(),earlyDepartureMinutes:record.checkOutAt?Math.max(0,Math.floor((expectedEnd.getTime()-record.checkOutAt.getTime())/60000)):null,isEarlyLeave:record.isEarlyLeave,graceMinutes:shift.gracePeriod,lateMinutes:minutes,earlyArrivalMinutes:record.checkInAt?Math.max(0,Math.floor((expected.getTime()-record.checkInAt.getTime())/60000)):null,minutesAfterGrace:minutes==null?null:Math.max(0,minutes-shift.gracePeriod),isLate:record.isLate,scheduleBasis:employee.shift?'assigned_shift':'attendance_default_policy'};
      });
      const incomplete = records.some(record => record.checkInAt && !record.checkOutAt);
      const valid = records.filter(record => record.checkInAt && record.checkOutAt);
      const minutes = valid.reduce((sum, record) => sum + Math.max(0, record.workMinutes), 0);
      let value = minutes / 60; let unit = 'recorded attendance hours';
      if (plan.average) { value = valid.length ? value / valid.length : 0; unit = 'average recorded hours per complete attendance record'; }
      if (plan.metric === 'present') { value = present.has(employee.id) ? 1 : 0; unit = 'employees checked in'; }
      if(plan.metric==='early-arrival'){value=attendanceEvents.filter(event=>event.checkInAt&&Date.parse(event.checkInAt)<Date.parse(event.scheduledStart)).length;unit='early arrival records';}
      if (plan.metric === 'early') { value = records.filter(record => record.isEarlyLeave).length; unit = 'early departure records'; }
      if (plan.metric === 'late') { value = records.filter(record => record.isLate).length; unit = 'late attendance records'; }
      if (plan.metric === 'missing-checkout') { value = records.filter(record => record.checkInAt && !record.checkOutAt).length; unit = 'missing checkout records'; }
      if (/\bbreak(?:s| duration)?\b/.test(plan.subjectText.toLowerCase())) addGap('A verified break-duration source is not connected; break time cannot be inferred from attendance.');
    if (plan.metric === 'absent') { value = !present.has(employee.id) && !leave.has(employee.id) ? 1 : 0; unit = 'employees with no attendance record'; }
      if (plan.metric === 'leave') { value = leave.has(employee.id) ? 1 : 0; unit = 'employees on approved leave'; }
      if (plan.metric === 'wfh') { value = wfh.has(employee.id) ? 1 : 0; unit = 'employees with approved WFH'; }
      report.rows.push({ employeeId: employee.id, name: fullName(employee), attendanceEvents, value: Number(value.toFixed(2)), unit, details: incomplete ? 'Missing checkout: full working duration cannot be confirmed.' : records.length ? records.slice(0,10).map(record => `${record.workDate.toISOString().slice(0,10)}: check-in ${record.checkInAt?.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}) || 'missing'}, checkout ${record.checkOutAt?.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}) || 'missing'}`).join('; ') : 'No attendance records found' });
      if (incomplete) addGap('Missing checkout records prevent confirmation of full working duration.');
    }
    addGap('Attendance hours use recorded workMinutes with check-in and checkout; they are not task activity or continuous productivity.');
    if (wfh.size) addGap('Approved WFH is not proof of working hours. Only validated attendance start/end records are counted.');
    if (plan.metric === 'absent') addGap('No attendance record is not a confirmed absence; schedule and leave validation may still be required.');
    report.totals.recordedHours = Number(report.rows.filter(row => row.unit === 'recorded attendance hours').reduce((sum, row) => sum + row.value, 0).toFixed(2));
  }
  if (['tasks', 'overview', 'exits', 'kpi'].includes(plan.kind)) {
    if (plan.kind === 'exits') {
      if (!['HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new ApiError(403, 'HR permission is required for employee exit history');
      const ex = employees.filter(employee => employee.dateOfExit && employee.dateOfExit >= new Date(plan.start) && employee.dateOfExit <= new Date(plan.end + 'T23:59:59Z'));
      const resignationOnly = plan.resignationOnly;
      employees = resignationOnly ? ex.filter(employee => /resign/i.test(employee.exitReason || '')) : ex;
    }
    const taskIds = employees.map(employee => employee.id);
    let tasks = checkLimit(await prisma.workCard.findMany({ where: { companyId: user.companyId!, assignedToId: { in: taskIds }, createdAt: { lte: times.end } }, select: { id: true, assignedToId: true, title: true, client: {select:{name:true}}, category: true, complexity: true, deadline: true, createdAt: true, status: true, updatedAt: true, statusHistory: { where: { createdAt: { lte: times.end } }, select: { status: true, createdAt: true }, orderBy: { createdAt: 'asc' } } }, take: limit }));
    if (plan.category) tasks = tasks.filter(task => plan.category === 'video' ? /video|reel|motion|edit/i.test(task.category) : /design|poster|creative|graphic/i.test(task.category));
    report.sources.push('WorkCard', 'StatusHistory');
    const completed = new Set(tasks.filter(task => { const first = task.statusHistory.find(event => ['APPROVED','FINISHED'].includes(event.status)); return first && first.createdAt >= times.start; }).map(task => task.id));
    const approved = new Set(tasks.filter(task => task.statusHistory.some(event => event.status === 'APPROVED' && event.createdAt >= times.start)).map(task => task.id));
    const pending = tasks.filter(task => { const status = task.statusHistory.at(-1)?.status || (plan.end >= calendarDate(new Date()) ? task.status : null); return status && !['APPROVED','FINISHED'].includes(status); });
    const statusAtEnd = (task: typeof tasks[number]) => task.statusHistory.at(-1)?.status || (plan.end >= calendarDate(new Date()) ? task.status : null);
    const awaitingApproval = tasks.filter(task => ['SUBMITTED', 'FINISHED', 'OUT_TO_DELIVER', 'WAITING_REVIEW', 'IN_REVIEW', 'PENDING_APPROVAL'].includes(statusAtEnd(task) || ''));
    const inProgress = tasks.filter(task => statusAtEnd(task) === 'IN_PROGRESS');
    const notStarted = pending.filter(task => ['PENDING', 'ASSIGNED', 'TODO'].includes(statusAtEnd(task) || ''));
    report.totals = { ...report.totals, inProgressTasks:inProgress.length, awaitingApproval: awaitingApproval.length, notStartedTasks: notStarted.length, assignedTasks: tasks.filter(task => task.createdAt >= times.start).length, completedTasks: completed.size, approvedTasks: approved.size, pendingTasks: pending.length, overdueTasks: pending.filter(task => task.deadline < asOf).length };
    for (const employee of employees) {
      const own = tasks.filter(task => task.assignedToId === employee.id);
      const summaryWork=!plan.groupByDepartment&&['summary','count'].includes(plan.metric);
      const selected = plan.metric === 'in-progress' ? own.filter(task=>inProgress.includes(task)) : summaryWork ? own.filter(task=>pending.includes(task)||completed.has(task.id)||awaitingApproval.includes(task)).sort((a,b)=>Number(inProgress.includes(b))-Number(inProgress.includes(a))) : plan.metric === 'approval' ? own.filter(task => awaitingApproval.includes(task)) : plan.metric === 'not-started' ? own.filter(task => notStarted.includes(task)) : plan.metric === 'pending' ? own.filter(task => pending.includes(task)) : plan.metric === 'overdue' ? own.filter(task => pending.includes(task) && task.deadline < asOf) : own.filter(task => completed.has(task.id));
      report.rows.push({ employeeId: employee.id, name: fullName(employee), value: selected.length, workSummary:summaryWork?{completed:own.filter(task=>completed.has(task.id)).length,pending:own.filter(task=>pending.includes(task)).length,inProgress:own.filter(task=>inProgress.includes(task)).length,approval:own.filter(task=>awaitingApproval.includes(task)).length}:undefined, workItems:selected.slice(0,10).map(task=>({title:task.title,clientName:task.client.name,overdueMinutes:pending.includes(task)?Math.max(0,Math.floor((asOf.getTime()-task.deadline.getTime())/60000)):0,deadline:task.deadline.toISOString(),status:statusAtEnd(task)})), unit: plan.metric === 'in-progress' ? 'tasks in progress' : summaryWork ? 'work report tasks' : plan.metric === 'approval' ? 'tasks awaiting approval' : plan.metric === 'not-started' ? 'tasks not started' : plan.metric === 'pending' ? 'pending tasks' : plan.metric === 'overdue' ? 'overdue tasks' : 'completed tasks', details: selected.slice(0, 10).map(task => task.title).join('; ') });
      if (own.some(task => task.statusHistory.length === 0)) addGap('Some tasks have no status history; their past completion dates cannot be verified.');
    }
    if (rules && ['most','least'].includes(plan.metric)) {
      const relevant = tasks.filter(task => approved.has(task.id));
      if (relevant.some(task => taskWeight(rules, task.category, task.complexity) == null)) addGap('Approved workload configuration does not cover all task categories and complexities; ranking is unavailable.');
      else {
        report.rows = employees.map(employee => ({ employeeId: employee.id, name: fullName(employee), value: Number(relevant.filter(task => task.assignedToId === employee.id).reduce((sum, task) => sum + taskWeight(rules, task.category, task.complexity)!, 0).toFixed(4)), unit: rules.unit }));
        report.sources.push('CompanySetting:ai_workload_rules_v1');
        report.totals.normalizedApprovedWorkload = report.rows.reduce((sum, row) => sum + row.value, 0);
      }
    }
    addGap('Raw task counts are output counts, not comparable employee performance or normalized workload.');
  }
  if (plan.kind === 'clients') {
    const admin = ['SUPER_ADMIN','HR_ADMIN'].includes(user.role);
    const clients = checkLimit(await prisma.client.findMany({ where: { companyId: user.companyId!, ...(admin ? {} : { OR: [{ accountManagerId: { in: ids } }, { workCards: { some: { assignedToId: { in: ids } } } }] }) }, select: { id: true, name: true, workCards: { where: { ...(admin ? {} : { assignedToId: { in: ids } }), createdAt: { lte: times.end } }, select: { id: true, deadline: true, title: true, category: true, status: true, statusHistory: { where: { createdAt: { lte: times.end } }, select: { status: true, createdAt: true }, orderBy: { createdAt: 'asc' } } }, take: limit } }, take: limit }));
    report.sources.push('Client','WorkCard','StatusHistory');
    for (const client of clients) checkLimit(client.workCards);
    const matchedClients=clients.filter(client=>plan.currentQuestion.toLowerCase().includes(client.name.toLowerCase()));
    report.rows = (matchedClients.length?matchedClients:clients).map(client => {
      const visible=client.workCards.filter(task=>!plan.category || (plan.category==='video'?/video|reel|motion|edit/i:/design|poster|creative|graphic/i).test(task.category));
      const selected=visible.filter(task=>{
        const status=task.statusHistory.at(-1)?.status || (plan.end>=calendarDate(new Date())?task.status:null);
        if(plan.metric==='pending') return status && !['APPROVED','FINISHED','REJECTED','CLIENT_REJECTED'].includes(status);
        if(plan.metric==='overdue') return status && !['APPROVED','FINISHED','REJECTED','CLIENT_REJECTED'].includes(status) && task.deadline<asOf;
        if(plan.metric==='approval') return ['FINISHED','OUT_TO_DELIVER','WAITING_REVIEW','IN_REVIEW'].includes(status||'');
        const first=task.statusHistory.find(event=>['APPROVED','FINISHED'].includes(event.status));return first && first.createdAt>=times.start;
      });
      return {employeeId:client.id,name:client.name,value:selected.length,workItems:selected.slice(0,10).map(task=>({title:task.title,clientName:client.name,overdueMinutes:!['APPROVED','FINISHED','REJECTED','CLIENT_REJECTED'].includes(task.statusHistory.at(-1)?.status||task.status)?Math.max(0,Math.floor((asOf.getTime()-task.deadline.getTime())/60000)):0,deadline:task.deadline.toISOString(),status:task.statusHistory.at(-1)?.status||(plan.end>=calendarDate(new Date())?task.status:null)})),unit:plan.metric==='pending'?'pending client deliverables':plan.metric==='overdue'?'overdue client deliverables':plan.metric==='approval'?'client deliverables awaiting approval':'completed client deliverables',details:selected.slice(0,10).map(task=>task.title).join('; ')};
    });
    report.totals.visibleClients = clients.length;
    addGap('Client visibility and deliverable counts are limited to authorized company and employee assignments. Project-specific metrics require a connected project source.');
  }
  if (plan.kind === 'data-entry') {
    // Read the tenant-owned setting directly. The existing WorkTrack reader merges other companies and is unsuitable for AI access.
    const setting = await prisma.companySetting.findUnique({ where: { companyId_key: { companyId: user.companyId!, key: 'worktrack_data_entry_sheets_v1' } }, select: { value: true, updatedAt: true } });
    report.sources.push('CompanySetting:worktrack_data_entry_sheets_v1');
    const sheets: any = typeof setting?.value === 'string' ? JSON.parse(setting.value) : setting?.value;
    const counts = new Map(ids.map(id => [id, 0]));
    let unattributed = 0;
    let processedRows = 0;
    for (const [key, rawRows] of Object.entries(sheets || {})) {
      if (!Array.isArray(rawRows)) continue;
      const match = key.match(/^(.+?)-(Jobs|Employer|SMM)-(\d{4}-\d{2}-\d{2})-(.+)$/);
      if (!match || match[3] < plan.start || match[3] > plan.end) continue;
      const employee = employees.find(employee => [employee.id, employee.userId, employee.employeeCode].includes(match[4]));
      if (!employee) { unattributed++; continue; }
      if (!employedDuring(employee, match[3], match[3])) continue;
      for (const row of rawRows as any[]) {
        if (++processedRows > 10000) throw new ApiError(400, "Too many data-entry records; choose a shorter period or specific employee");
        const status = String(row.status || '').toLowerCase();
        if (!/^(uploaded|published|approved|completed|updated)$/.test(status)) continue;
        if (plan.updatedOnly && (match[2] !== 'Jobs' || status !== 'updated')) continue;
        if (plan.employerOnly && match[2] !== 'Employer') continue;
        if (plan.publishedOnly && (match[2] !== 'Jobs' || status === 'updated')) continue;
        if (!row.companyName && !row.sourceUrl && !row.category && !row.jobTitle) continue;
        const count = match[2] === 'Jobs' ? (Number.isFinite(Number(row.jobCount)) && row.jobCount !== '' && row.jobCount != null ? Number(row.jobCount) : row.categoryCounts ? Object.values(row.categoryCounts).reduce<number>((sum, n) => sum + Math.max(0, Number(n) || 0), 0) : 1) : 1;
        counts.set(employee.id, (counts.get(employee.id) || 0) + Math.max(0, count));
      }
    }
    report.rows = employees.map(employee => ({ employeeId: employee.id, name: fullName(employee), value: counts.get(employee.id) || 0, unit: plan.publishedOnly ? 'published jobs' : plan.updatedOnly ? 'explicitly recorded job updates' : plan.employerOnly ? 'recorded company additions' : 'recorded data-entry activities' }));
    report.totals.activities = report.rows.reduce((sum, row) => sum + row.value, 0);
    if (plan.updatedOnly) addGap('Only explicitly Updated rows can confirm job updates; editing a row timestamp is not a separate verified update event.');
    if (!setting) addGap('No company-owned data-entry source is configured; counts cannot be confirmed.');
    if (unattributed) addGap('Some sheets have unmatched employee identifiers; they were excluded rather than attributed by name.');
    addGap('Recorded activity is distinct from approved workload; unpublished and unrecognized status rows are excluded.');
  }
  if (plan.kind === 'kpi') {
    report.rows = [];
    const reviews = checkLimit(await prisma.appraisal.findMany({ where: { companyId: user.companyId!, employeeId: { in: ids }, status: 'APPROVED', appraisalCycle: { startDate: { lte: times.end }, endDate: { gte: times.start } } }, select: { employeeId: true, finalScore: true, appraisalCycle: { select: { title: true, startDate: true, endDate: true } } }, take: limit }));
    report.sources.push('Appraisal:approved', 'AppraisalCycle');
    for (const review of reviews) if (review.finalScore != null) report.rows.push({ employeeId: review.employeeId, name: name(review.employeeId), value: review.finalScore, unit: 'approved appraisal score', details: `${review.appraisalCycle.title} (${review.appraisalCycle.startDate.toISOString().slice(0,10)}–${review.appraisalCycle.endDate.toISOString().slice(0,10)})` });
    addGap('These are recorded approved appraisal scores, not a newly calculated KPI. No verified cross-department workload-equivalency or KPI formula is available in this integration.');
    if (!report.rows.length) addGap('No approved performance scores were found for this period.');
  }
  if (plan.kind === 'leave' && plan.leaveHistory) {
    const requests = checkLimit(await prisma.wFHRequest.findMany({ where: { employeeId: { in: ids }, startDate: { lte: times.end }, endDate: { gte: times.start } }, select: { employeeId: true, startDate: true, endDate: true, status: true, reason: true }, take: limit }));
    report.sources.push('WFHRequest:leave-history');
    report.rows = requests.filter(request => /\[.*leave.*\]/i.test(request.reason)).map(request => ({ employeeId: request.employeeId, name: name(request.employeeId), value: 1, unit: 'leave request', details: `${request.status}: ${request.startDate.toISOString().slice(0,10)}–${request.endDate.toISOString().slice(0,10)}` }));
    report.totals.leaveRequests = report.rows.length;
  }
  if (plan.kind === 'leave' && !plan.leaveHistory) {
    const allocations = checkLimit(await prisma.leaveAllocation.findMany({ where: { employeeId: { in: ids }, year: Number(plan.start.slice(0,4)) }, select: { employeeId: true, leaveType: true, maxDays: true, usedDays: true }, take: limit }));
    report.sources.push('LeaveAllocation');
    if (!allocations.length) addGap('No leave allocation records are available; a zero balance cannot be assumed.');
    report.rows = allocations.map(row => ({ employeeId: row.employeeId, name: name(row.employeeId), value: Math.max(0, Number(row.maxDays) - Number(row.usedDays)), unit: `${row.leaveType} remaining days` }));
    addGap('Leave allocation balances are current stored balances for the allocation year, not reconstructed historical balances.');
  }
  if (!employees.length) addGap('No authorized employees were employed during this period.');
  return report;
}
export function formatVerifiedReport(report: VerifiedReport): string {
  const { plan, rows } = report;
  if(plan.kind==='attendance'&&plan.metric==='early-arrival'){
    const early=rows.filter(row=>row.value>0);
    if(!early.length)return `No check-ins before shift start were found for ${plan.start}–${plan.end}.`;
    const clock=(value:string)=>new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true});
    return `${early.length} ${early.length===1?'employee has':'employees have'} a check-in before shift start for ${plan.start}–${plan.end}.\n\n`+early.slice(0,50).flatMap(row=>(row.attendanceEvents||[]).filter(event=>event.checkInAt&&Date.parse(event.checkInAt)<Date.parse(event.scheduledStart)).map(event=>`${row.name} checked in at ${clock(event.checkInAt!)}${plan.start!==plan.end?' on '+event.date:''}. The available shift start is ${clock(event.scheduledStart)}, so this is ${event.earlyArrivalMinutes?event.earlyArrivalMinutes+' minutes':'less than a minute'} before shift start.`)).join('\n\n')+'\n\nThe calculation uses the available shift settings; historical shift changes cannot be reconstructed.';
  }
  if(plan.kind==='attendance' && plan.metric==='late') {
    const late=rows.filter(row=>row.value>0);
    if(!late.length)return `No late attendance records were found for ${plan.start}–${plan.end}.`;
    const clock=(value:string)=>new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true});
    return `${late.length} employees have recorded late arrivals for ${plan.start}–${plan.end}. `+late.slice(0,50).map(row=>`${row.name}: `+(row.attendanceEvents||[]).filter(event=>event.isLate).map(event=>`${plan.start!==plan.end?event.date+' ':''}checked in at ${event.checkInAt?clock(event.checkInAt):'an unavailable time'}, scheduled start ${clock(event.scheduledStart)}${event.lateMinutes!=null&&event.lateMinutes>0?`, ${event.lateMinutes} minutes after shift start`:', exact delay could not be verified'}`).join('; ')+'.').join(' ')+' Delay uses the currently available shift assignment, or the attendance system default when no shift is assigned. Historical shift changes are not reconstructed.';
  }
  if(plan.kind==='attendance'&&plan.metric==='early') {
    const early=rows.filter(row=>row.value>0);
    const clock=(value:string)=>new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true});
    return early.length?early.flatMap(row=>(row.attendanceEvents||[]).filter(event=>event.isEarlyLeave).map(event=>`${row.name}${plan.start!==plan.end?' on '+event.date:''}: checked out at ${event.checkOutAt?clock(event.checkOutAt):'an unavailable time'}, scheduled shift end ${clock(event.scheduledEnd)}${event.earlyDepartureMinutes!=null?', '+event.earlyDepartureMinutes+' minutes before shift end':'; exact early departure duration is unavailable'}.`)).join(' ')+' Times are IST and use the available shift settings; historical shift changes are not reconstructed.':`No early departure records found for ${plan.start}–${plan.end}.`;
  }
  if (plan.kind === 'overview') {
    const labels: Record<string,string> = { employees:'Employees in scope', checkedIn:'Checked in', approvedWfh:'Approved WFH', approvedLeave:'Approved leave', noAttendanceRecord:'No attendance record', completedTasks:'Tasks completed', approvedTasks:'Tasks approved', pendingTasks:'Tasks pending', overdueTasks:'Tasks overdue', awaitingApproval:'Awaiting approval', notStartedTasks:'Tasks not started' };
    return `**Company overview · ${plan.start}–${plan.end} · IST**\n\n` + Object.entries(labels).filter(([key])=>report.totals[key]>0).map(([key,label])=>`- ${label}: **${report.totals[key]}**`).join('\n') + '\n\nNo attendance record does not establish absence. Task counts describe recorded output, not comparable employee performance.';
  }
  if (/\bbreak(?:s| duration)?\b/.test(plan.subjectText.toLowerCase())) return 'Verified break-duration records are not connected, so break time cannot be confirmed.';
  if (plan.compare) plan.detailed = true;
  if (!plan.compare && (plan.metric === 'most' || plan.metric === 'least')) {
    if (plan.kind === 'attendance' && report.gaps.some(gap => /Missing checkout/.test(gap))) return 'The longest full working duration cannot be confirmed because checkout records are missing. Recorded partial hours are available in the detailed report.';
    if (!rows.length || rows.every(row => row.value === 0)) return `No verified ${plan.kind} result is available for ${plan.start}–${plan.end}. ${report.gaps[0] || ''}`;
    if (plan.kind === 'tasks' && (new Set(report.employees.map(employee => employee.department)).size > 1 || /workload|work this|performed|performance|best|worst/i.test(plan.subjectText)) && !report.sources.includes('CompanySetting:ai_workload_rules_v1')) return `Cross-department workload ranking is unavailable because approved equivalency rules are not connected. Raw completion counts can be shown separately.`;
    if (plan.kind === 'kpi') return `A best/worst performance ranking cannot be verified without approved comparable KPI and workload rules. ${rows.length} approved appraisal score(s) are available.`;
    const value = (plan.metric === 'most' ? Math.max : Math.min)(...rows.map(row => row.value));
    const winners = rows.filter(row => row.value === value);
    return `${winners.map(row => `**${row.name}**`).join(', ')} — **${value} ${winners[0].unit}**${winners.length > 1 ? ' each (tie)' : ''}, ${plan.start}–${plan.end}.${report.gaps.some(gap => /Missing checkout/.test(gap)) ? ' Missing checkouts mean the longest full duration cannot be confirmed.' : ''}`;
  }
  if(plan.groupByDepartment) {
    const groups=new Map<string,number>();for(const row of rows){const department=report.employees.find(employee=>employee.id===row.employeeId)?.department||'Unassigned';groups.set(department,(groups.get(department)||0)+row.value);}
    return [...groups].filter(([,count])=>count>0).map(([department,count])=>`- **${department}**: **${count}** recorded task completions`).join('\n')+'\nRaw completion counts do not establish comparable performance across different types of work.';
  }
  const summary = Object.entries(report.totals).map(([key,value]) => `${key.replace(/([A-Z])/g,' $1').toLowerCase()}: **${value}**`).join('; ');
  const selected = ['late','early','early-arrival','absent','wfh','leave','missing-checkout','pending','overdue','present','approval','not-started'].includes(plan.metric) ? rows.filter(row => row.value > 0) : rows.filter(row => row.value > 0);
  const showRecordedTimes = /check.?in|check.?out|break/i.test(plan.subjectText);
  const workDetails=(row:typeof rows[number])=>row.workItems?.map(item=>`${item.clientName?item.clientName+' — ':''}${item.title} (${item.status||'status unavailable'}; deadline ${new Date(item.deadline).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST${item.overdueMinutes?'; '+item.overdueMinutes+' minutes overdue':''})`).join('; ');
  const detail = selected.slice(0, plan.detailed ? 50 : 5).map(row => `- **${row.name}**: **${row.value} ${row.unit}**${row.workItems?.length ? ` — ${workDetails(row)}` : (plan.detailed || showRecordedTimes) && row.details ? ` — ${row.details}` : ''}`).join('\n');
  let answer = plan.metric === 'count' && summary ? summary + '.' : detail || summary || `No verified ${plan.kind} records found for ${plan.start}–${plan.end}.`;
  if (plan.kind === 'data-entry' && report.gaps.some(gap => gap.startsWith('No company-owned'))) return report.gaps.join(' ');
  if (plan.detailed && selected.length > 50) report.gaps.push('Only the first 50 detail rows are displayed; totals use all retrieved records.');
  if (plan.detailed) answer = `**${plan.start}–${plan.end} · ${report.timezone}**\n\n${summary}\n\n${detail}\n\n${report.gaps.join(' ')}`;
  else if (report.gaps.length && ['hours', 'kpi','leave'].includes(plan.kind === 'attendance' && plan.metric === 'hours' ? 'hours' : plan.kind)) answer += `\n${report.gaps[0]}`;
  if (report.comparison) {
    const old = report.comparison;
    const changes = Object.entries(report.totals).filter(([key]) => old.totals[key] != null).map(([key,value]) => `${key}: ${old.totals[key]} → ${value} (${value-old.totals[key] >= 0 ? '+' : ''}${Number((value-old.totals[key]).toFixed(2))})`).join('; ');
    answer += `\nCompared with ${old.plan.start}–${old.plan.end}: ${changes || 'Comparable aggregate metrics are unavailable.'} Recorded changes do not establish their cause.`;
    if (plan.kind === 'kpi') answer += `\nPrevious approved appraisal records:\n${old.rows.slice(0,50).map(row=>`- ${row.name}: ${row.value} ${row.unit} — ${row.details || ''}`).join('\n') || 'No approved scores found.'}\nScore changes are comparable only when appraisal scales and rules match.`;
  }
  return answer;
}
export const verifiedAnalyticsService = {
  async answer(user: UserContext, question: string, history: { role: string; text: string }[] = [], resolvedPlan?: QueryPlan) {
    const plan = resolvedPlan || await identifyReadOnlyQuery(question, history);
    let report: VerifiedReport;
    try { report = await runVerifiedReport(user, plan); }
    catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'STEMS source records are unavailable. No counts or performance values were estimated. Please try again.');
    }
    // Audit metadata contains routing and time range, never query text, employee names or source records.
    await prisma.auditLog.create({ data: { actorUserId: user.userId, action: 'AI_READ_REPORT', entity: 'AIAnalytics', metadata: { kind: plan.kind, start: plan.start, end: plan.end, companyId: user.companyId, sourceCount: report.sources.length } } });
    if (plan.compare) report.comparison = await runVerifiedReport(user, { ...plan, ...previousPeriod(plan), compare: false });
    return { report, markdown: formatVerifiedReport(report) };
  }
};
