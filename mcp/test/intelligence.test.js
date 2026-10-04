import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriod, findEmployees } from '../src/intelligence.js';
import { buildPerformanceReport } from '../src/performance.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
const now=new Date('2026-10-03T20:00:00Z');
test('India date boundaries and natural periods',()=>{
 const expected={'today':['2026-10-04','2026-10-04'],'yesterday':['2026-10-03','2026-10-03'],'this week':['2026-09-28','2026-10-04'],'last week':['2026-09-21','2026-09-27'],'last month':['2026-09-01','2026-09-30'],'last 7 days':['2026-09-28','2026-10-04'],'Monday':['2026-09-28','2026-09-28']};
 for(const [period,dates]of Object.entries(expected)){const r=resolvePeriod({period},now);assert.deepEqual([r.date_from,r.date_to],dates);}
 assert.throws(()=>resolvePeriod({date_from:'2026-02-30',date_to:'2026-03-01'}));
 assert.throws(()=>resolvePeriod({date_from:'2026-10-05',date_to:'2026-10-01'}));
});
test('duplicate names and exact employee codes',()=>{const e=[{id:'a',firstName:'Asha',employeeCode:'A1'},{id:'b',firstName:'Asha',employeeCode:'A2'}];assert.equal(findEmployees(e,'Asha').length,2);assert.equal(findEmployees(e,'a1')[0].id,'a');assert.equal(findEmployees(e,'nobody').length,0);});
test('date ranges retain pending backlog and exclude outside activity',()=>{
 const r=buildPerformanceReport({employees:[{id:'a',companyId:'c',firstName:'Asha'}],attendance:[],cards:[{id:'old',assignedToId:'a',createdAt:'2026-08-01',status:'PENDING',statusHistory:[]}],sheets:{s:[{employeeId:'a',date:'2026-10-03',postId:1},{employeeId:'a',date:'2026-10-04',postId:2}]},workCompanyId:'c',month:10,year:2026,dateFrom:'2026-10-04',dateTo:'2026-10-04',sourceStatus:{}});
 assert.equal(r.employees[0].work.tasks.length,1);assert.equal(r.employees[0].dataEntry.monthlyRowCount,1);
});
const employees=[{id:'a',companyId:'c',firstName:'Fuhad',employeeCode:'ST001',department:{name:'Marketing'}}];
async function session(fn){const [a,b]=InMemoryTransport.createLinkedPair();const calls=[];const server=createServer({token:'test',fetchImpl:async url=>{calls.push(url.pathname);const map={'/api/employees':employees,'/api/auth/me/access':{user:{companyId:'c'}},'/api/attendance/report':[],'/api/work-track/cards':[],'/api/work-track/data-entry-sheets':{},'/api/performance/goals':[], '/api/performance/kras':[]};return map[url.pathname]===undefined?Response.json({}, {status:403}):Response.json(map[url.pathname]);}});const client=new Client({name:'test',version:'1'});await server.connect(b);await client.connect(a);try{await fn(client,calls);}finally{await client.close();await server.close();}}
test('360 combines sources and does not invent session measurements',()=>session(async(client,calls)=>{const r=await client.callTool({name:'get_employee_360',arguments:{employee_id:'a',date_from:'2026-09-30',date_to:'2026-10-04'}});assert.ok(!r.isError);const data=JSON.parse(r.content[0].text);assert.equal(data.employees[0].work_sessions.idle_minutes,null);assert.equal(calls.filter(p=>p==='/api/attendance/report').length,2);assert.ok(calls.includes('/api/performance/goals'));}));
test('invisible employees are denied before source access',()=>session(async(client,calls)=>{const r=await client.callTool({name:'get_employee_360',arguments:{employee_id:'hidden',period:'today'}});assert.equal(r.isError,true);assert.deepEqual(calls,['/api/employees']);}));
const subjects=['Fuhad','Rishana','Asha','ST001','HF002'];
const prompts=['How did NAME perform today?','What did NAME work on yesterday?','When did NAME start work today?','When did NAME stop working yesterday?','How many hours did NAME work this week?','Was NAME active today?','How much idle time did NAME have yesterday?','What tasks did NAME complete today?','What tasks are pending for NAME this month?','Does NAME have overdue work today?','What project is NAME working on today?','Show NAME activity for last 7 days.','Show NAME work history last 30 days.','How productive was NAME last month?','Show NAME attendance this week.','Show NAME data entry today.','Show NAME performance last week.','Show NAME targets this month.','Show NAME break time yesterday.','Show NAME activity Monday.'];
export const questions=subjects.flatMap(subject=>prompts.map(prompt=>prompt.replaceAll('NAME',subject)));
test('100 realistic questions produce executable plans without fabricated live measurements',()=>session(async client=>{assert.equal(questions.length,100);for(const question of questions){const r=await client.callTool({name:'plan_employee_query',arguments:{question,employee_id:'a'}});assert.ok(!r.isError,question);const p=JSON.parse(r.content[0].text);assert.equal(p.steps[0].tool,'get_employee_360');assert.equal(p.steps[0].arguments.employee_id,'a');assert.ok(p.period.date_from<=p.period.date_to);}}));
test('follow-up employee context and week comparison plan',()=>session(async client=>{
 const yesterday=JSON.parse((await client.callTool({name:'plan_employee_query',arguments:{question:'What about yesterday?',employee_id:'a'}})).content[0].text);
 assert.equal(yesterday.steps[0].arguments.employee_id,'a');
 assert.equal(yesterday.period.date_from,yesterday.period.date_to);
 const comparison=JSON.parse((await client.callTool({name:'plan_employee_query',arguments:{question:'Compare this week with last week',employee_id:'a'}})).content[0].text);
 assert.equal(comparison.steps[0].tool,'compare_employee_periods');
 assert.ok(comparison.steps[0].arguments.second_to<comparison.steps[0].arguments.first_from);
}));
test('department, company, ranking and unavailable live status tools return structured evidence',()=>session(async client=>{
 for(const [name,args] of [['get_department_summary',{department:'Marketing',period:'today'}],['get_company_work_summary',{period:'today'}],['get_top_performers',{metric:'data_entry_rows',period:'today'}],['get_currently_working_employees',{period:'today'}]]){
 const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,name);const data=JSON.parse(r.content[0].text);assert.ok(data.period);if(name==='get_currently_working_employees')assert.equal(data.available,false);
 }
}));

test('denied scoped evidence never falls back to broader company cards',()=>session(async(client,calls)=>{
 const result=JSON.parse((await client.callTool({name:'get_employee_tasks',arguments:{employee_id:'a',period:'today'}})).content[0].text);
 assert.equal(result.tasks.available,false);assert.ok(!calls.includes('/api/work-track/cards'));assert.equal(result.data_quality.tasks.http_status,403);
}));
