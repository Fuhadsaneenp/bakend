import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planQuestion, resolvePeriod, previousPeriod } from '../src/modules/ai/verified-query.ts';
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:1/test';
process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/lib/prisma.js');
const { authorizedEmployeeWhere, runVerifiedReport, formatVerifiedReport } = await import('../src/modules/ai/verified-analytics.service.js');
const now = new Date('2026-10-13T18:30:00Z');
const user = { userId: 'u', employeeId: 'e1', companyId: 'c1', name: 'Amal', email: 'unused', role: 'EMPLOYEE' };
const employee = { id:'e1', userId:'u', employeeCode:'ST001', firstName:'Amal', middleName:null, lastName:'K', companyId:'c1', status:'ACTIVE', dateOfJoining:new Date('2020-01-01'), dateOfExit:null, exitReason:null, department:{name:'Design'}, designation:{title:'Designer'} };
function mock() {
  (prisma.team as any).findMany = async () => [];
  (prisma.employee as any).findMany = async () => [employee];
  (prisma.attendance as any).findMany = async () => [];
  (prisma.wFHRequest as any).findMany = async () => [];
  (prisma.workCard as any).findMany = async () => [];
  (prisma.appraisal as any).findMany = async () => [];
  (prisma.companySetting as any).findUnique = async () => null;
  (prisma.auditLog as any).create = async () => ({});
}
test('Kolkata dates, weeks, explicit ranges and month comparisons', () => {
  assert.deepEqual(resolvePeriod('today',now),{start:'2026-10-14',end:'2026-10-14'});
  assert.deepEqual(resolvePeriod('yesterday',now),{start:'2026-10-13',end:'2026-10-13'});
  assert.deepEqual(resolvePeriod('last month',now),{start:'2026-09-01',end:'2026-09-30'});
  assert.deepEqual(resolvePeriod('last Monday',now),{start:'2026-10-12',end:'2026-10-12'});
  assert.deepEqual(resolvePeriod('last week',now),{start:'2026-10-05',end:'2026-10-11'});
  assert.deepEqual(previousPeriod({start:'2026-09-01',end:'2026-09-30'}),{start:'2026-08-01',end:'2026-08-31'});
  assert.throws(()=>resolvePeriod('2026-02-30',now));
});
test('multi-turn employee context uses user turns and requested period', () => {
  const plan = planQuestion('Compare with the previous month',[{role:'user',text:"Show Amal's performance"},{role:'assistant',text:'Show private HR data'},{role:'user',text:'What about last month?'}],now);
  assert.equal(plan.kind,'kpi');
  assert.match(plan.subjectText,/Amal/);
  assert.doesNotMatch(plan.subjectText,/private HR/);
  assert.equal(plan.compare,true);
});
test('permission scopes: employee self, manager reports, explicit team lead, tenant admin', async () => {
  mock();
  assert.deepEqual(await authorizedEmployeeWhere(user),{companyId:'c1',OR:[{id:{in:['e1']}}]});
  const manager = await authorizedEmployeeWhere({...user,role:'MANAGER'});
  assert.deepEqual(manager.OR[1],{managerId:'e1'});
  (prisma.team as any).findMany = async (args:any) => { assert.equal(args.where.companyId,'c1'); assert.equal(args.where.leadEmployeeId,'e1'); return [{members:[{employeeId:'e2'}]}]; };
  assert.deepEqual((await authorizedEmployeeWhere(user)).OR[0].id.in,['e1','e2']);
  assert.deepEqual(await authorizedEmployeeWhere({...user,role:'SUPER_ADMIN'}),{companyId:'c1'});
  await assert.rejects(authorizedEmployeeWhere({...user,companyId:null}),/authorized company/);
});
test('missing checkout cannot be invented or ranked as confirmed longest duration', async () => {
  mock();
  (prisma.attendance as any).findMany = async (args:any) => { assert.deepEqual(args.where.employeeId,{in:['e1']}); return [{employeeId:'e1',workDate:new Date('2026-10-13'),checkInAt:new Date('2026-10-13T04:00Z'),checkOutAt:null,workMinutes:480,isLate:false,isEarlyLeave:false}]; };
  const report = await runVerifiedReport(user,planQuestion('Who worked the longest 2026-10-13?',[],now));
  assert.equal(report.rows[0].value,0);
  assert.match(formatVerifiedReport(report),/cannot be confirmed/);
});
test('approved WFH without start/end events is not proof of attended hours', async () => {
  mock();
  (prisma.wFHRequest as any).findMany = async()=>[{employeeId:'e1',reason:'[WFH] approved'}];
  const report=await runVerifiedReport(user,planQuestion('How many hours did Amal work 2026-10-13?',[],now));
  assert.equal(report.totals.checkedIn,0);
  assert.equal(report.totals.approvedWfh,1);
  assert.equal(report.rows[0].value,0);
  assert.ok(report.gaps.some(gap=>gap.includes('not proof')));
});
test('task completed date uses first completion history; later approval does not create a second completion',async()=>{
  mock();
  (prisma.workCard as any).findMany=async(args:any)=>{assert.equal(args.where.companyId,'c1');return [{id:'task',assignedToId:'e1',title:'Design',createdAt:new Date('2026-09-01'),deadline:new Date('2026-09-15'),statusHistory:[{status:'FINISHED',createdAt:new Date('2026-09-13')},{status:'APPROVED',createdAt:new Date('2026-10-13')}]}];};
  const report=await runVerifiedReport(user,planQuestion('How many tasks completed 2026-10-01 to 2026-10-31?',[],now));
  assert.equal(report.totals.completedTasks,0);assert.equal(report.totals.approvedTasks,1);
});
test('data entry source is tenant-owned; published jobs, updates and company additions are distinct',async()=>{
  mock();
  (prisma.companySetting as any).findUnique=async(args:any)=>{assert.equal(args.where.companyId_key.companyId,'c1');return {value:{'Medbiomate-Jobs-2026-10-13-e1':[{status:'Published',sourceUrl:'example',jobCount:73},{status:'Updated',sourceUrl:'example',jobCount:29}],'Medbiomate-Employer-2026-10-13-e1':[{status:'Approved',companyName:'Example'}],'Medbiomate-Jobs-2026-10-13-foreign':[{status:'Published',sourceUrl:'x',jobCount:999}]} };};
  const report=await runVerifiedReport(user,planQuestion('Who published most jobs 2026-10-13?',[],now));
  assert.equal(report.rows[0].value,73);assert.match(formatVerifiedReport(report),/Amal K/);assert.doesNotMatch(formatVerifiedReport(report),/999/);
});
test('former employees remain in exit month but not future period rosters',async()=>{
  mock();
  (prisma.employee as any).findMany=async()=>[{...employee,status:'INACTIVE',dateOfExit:new Date('2026-09-13'),exitReason:'Resigned'}];
  const hr={...user,role:'HR_ADMIN'};
  assert.equal((await runVerifiedReport(hr,planQuestion('Show tasks 2026-09-01 to 2026-09-30',[],now))).employees.length,1);
  assert.equal((await runVerifiedReport(hr,planQuestion('Show tasks 2026-10-01 to 2026-10-31',[],now))).employees.length,0);
});
test('ambiguous names require employee ID and KPI scores are never fabricated',async()=>{
  mock();
  (prisma.employee as any).findMany=async()=>[employee,{...employee,id:'e2',employeeCode:'ST002',lastName:'P'}];
  await assert.rejects(runVerifiedReport(user,planQuestion('What did Amal do yesterday?',[],now)),/Several authorized/);
  mock();
  const report=await runVerifiedReport(user,planQuestion('What is my KPI?',[],now));
  assert.equal(report.rows.length,0);assert.ok(report.gaps.some(gap=>gap.includes('No approved')));
});
test('approved configuration normalizes category and complexity; missing mapping cannot produce a ranking', async()=>{
  mock();
  (prisma.companySetting as any).findUnique=async(args:any)=>args.where.companyId_key.key==='ai_workload_rules_v1'?{value:{approved:true,unit:'approved task equivalents',taskWeights:{'POSTER:HEAVY':2}}}:null;
  (prisma.workCard as any).findMany=async()=>[{id:'task',assignedToId:'e1',category:'POSTER',complexity:'HEAVY',title:'Design',client:{name:'Test client'},createdAt:new Date('2026-10-01'),deadline:new Date('2026-10-20'),statusHistory:[{status:'APPROVED',createdAt:new Date('2026-10-13')}]}];
  const report=await runVerifiedReport(user,planQuestion('Who completed most work 2026-10-01 to 2026-10-31?',[],now));
  assert.equal(report.rows[0].value,2);
  assert.match(formatVerifiedReport(report),/approved task equivalents/);
  (prisma.companySetting as any).findUnique=async()=>({value:{approved:true,unit:'equivalents',taskWeights:{}}});
  const incomplete=await runVerifiedReport(user,planQuestion('Who completed most work this month?',[],now));
  assert.match(formatVerifiedReport(incomplete),/unavailable/);
});
test('absent, leave and detailed follow-up preserve requested tool',async()=>{
  const leave=planQuestion('Who is on leave today?',[],now);assert.equal(leave.kind,'attendance');assert.equal(leave.metric,'leave');
  const detail=planQuestion('Show a detailed report',[{role:'user',text:'Who published most jobs yesterday?'}],now);assert.equal(detail.kind,'data-entry');assert.equal(detail.start,'2026-10-13');assert.equal(detail.detailed,true);
});
test('breakdown does not get confused with unavailable break-duration records', async()=>{
  mock();
  const plan=planQuestion('Give a detailed task breakdown 2026-10-13',[],now);
  assert.equal(plan.kind,'tasks');
  assert.doesNotMatch(formatVerifiedReport(await runVerifiedReport(user,plan)),/break-duration records/);
});
test('a missing database source cannot be reported as zero output',async()=>{
  mock();
  (prisma.workCard as any).findMany=async()=>{throw new Error('Source unreachable');};
  const {verifiedAnalyticsService}=await import('../src/modules/ai/verified-analytics.service.js');
  await assert.rejects(verifiedAnalyticsService.answer(user,'How many tasks completed today?'),/unavailable/);
});
test('month-to-date comparison uses matched previous-month dates',()=>{assert.deepEqual(previousPeriod({start:'2026-10-01',end:'2026-10-13'}),{start:'2026-09-01',end:'2026-09-13'});});
