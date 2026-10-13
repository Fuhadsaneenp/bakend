import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:1/test';
process.env.NODE_ENV = 'test';
const { prisma } = await import('../src/lib/prisma.js');
const { employeeRouter } = await import('../src/modules/employees/employee.routes.js');
const { employeeService } = await import('../src/modules/employees/employee.service.js');
const { assertActiveEmployee } = await import('../src/lib/employeeEligibility.js');
const { workTrackService } = await import('../src/modules/work-track/work-track.service.js');
const handler = (path: string, method: string) => (employeeRouter as any).stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const employee = { id: 'employee', userId: 'user', companyId: 'company', status: 'ACTIVE', dateOfJoining: new Date('1999-01-01'), dateOfExit: null };
let writes: any[];
let lookup: any;
function setup(record: any = employee) {
  writes = [];
  (prisma.employee as any).findFirst = async (args: any) => { lookup = args.where; return record?.companyId === (args.where.companyId || record?.companyId) ? record : null; };
  (prisma as any).$transaction = async (fn: any) => fn({
    employee: { update: async (args: any) => { writes.push(['employee', args]); return { ...record, ...args.data }; } },
    user: { update: async (args: any) => { writes.push(['user', args]); } },
    auditLog: { create: async (args: any) => { writes.push(['audit', args]); } }
  });
}
async function exit(body: any, companyId = 'company') {
  let result: any, error: any;
  await handler('/:id/exit', 'post')({ user: { id: 'hr', role: 'HR_ADMIN', companyId }, params: { id: 'employee' }, body }, { json: (value: any) => { result = value; } }, (value: any) => { error = value; });
  return { result, error };
}
test('effective resignation updates only employee/account/audit; all related history remains untouched', async () => {
  setup();
  const { result, error } = await exit({ dateOfExit: '2000-10-13', exitReason: 'Resigned' });
  assert.equal(error, undefined);
  assert.equal(result.status, 'INACTIVE');
  assert.equal(result.exitReason, 'Resigned');
  assert.deepEqual(writes.map(entry => entry[0]), ['employee', 'user', 'audit']);
  assert.equal(writes[1][1].data.isActive, false);
  assert.equal(result.id, employee.id);
  assert.equal(lookup.companyId, 'company');
});
test('scheduled retirement keeps account usable until date cutoff', async () => {
  setup();
  const { result, error } = await exit({ dateOfExit: '2099-10-13', exitReason: 'Retired' });
  assert.equal(error, undefined);
  assert.equal(result.status, 'ACTIVE');
  assert.deepEqual(writes.map(entry => entry[0]), ['employee', 'audit']);
});
test('legacy reason accepted without labeling resignation as termination', async () => {
  setup();
  const { result } = await exit({ dateOfExit: '2000-10-13T00:00:00.000Z', exitReason: 'Resignation' });
  assert.equal(result.exitReason, 'Resigned');
});
test('invalid reasons, impossible dates and pre-joining dates cannot mutate employee data', async () => {
  for (const body of [
    { dateOfExit: '2000-02-30', exitReason: 'Others' },
    { dateOfExit: 'invalid', exitReason: 'Others' },
    { dateOfExit: '1998-01-01', exitReason: 'Retired' },
    { dateOfExit: '2000-01-01', exitReason: 'invalid' }
  ]) {
    setup();
    assert.ok((await exit(body)).error);
    assert.equal(writes.length, 0);
  }
});
test('HR cannot exit another company employee', async () => {
  setup();
  assert.equal((await exit({ dateOfExit: '2000-01-01', exitReason: 'Terminated' }, 'other-company')).error.statusCode, 404);
  assert.equal(writes.length, 0);
});
test('exited employee is rejected by API even when a stale task dropdown submits their ID', async () => {
  setup({ ...employee, dateOfExit: new Date('2000-10-13') });
  await assert.rejects(assertActiveEmployee('employee', 'company'), /not eligible/);
  await assert.rejects(workTrackService.createWorkCard('company', 'creator', { clientId: 'client', title: 'Task', brief: '', category: 'POSTER', priority: 'LOW', complexity: 'LOW', deadline: '2099-01-01', assignedToId: 'employee' }), /not eligible/);
  assert.equal(writes.length, 0);
});
test('history protected against employee deletion and status-based reactivation', async () => {
  setup({ ...employee, dateOfExit: new Date('2000-10-13') });
  const hr = { id: 'hr', role: 'HR_ADMIN', companyId: 'company' } as any;
  await assert.rejects(employeeService.deleteEmployee(hr, 'employee', 'CONFIRM'), /protected/);
  await assert.rejects(employeeService.updateStatus(hr, 'employee', 'ACTIVE'), /cannot be reactivated/);
  assert.equal(writes.length, 0);
});
test('default employee selections are active; archive and period queries preserve former employees', async () => {
  const roster = [
    { ...employee, id: 'current' },
    { ...employee, id: 'exited', status: 'INACTIVE', dateOfExit: new Date('2000-10-13') },
    { ...employee, id: 'scheduled', dateOfExit: new Date('2099-10-13') }
  ];
  const original = employeeService.listForUser;
  employeeService.listForUser = async () => roster as any;
  try {
    for (const [query, expected] of [
      [{}, ['current', 'scheduled']],
      [{ scope: 'history' }, ['exited']],
      [{ scope: 'all' }, ['current', 'exited', 'scheduled']],
      [{ scope: 'period', start: '2000-10-01', end: '2000-10-31' }, ['current', 'exited', 'scheduled']],
      [{ scope: 'period', start: '2000-11-01', end: '2000-11-30' }, ['current', 'scheduled']]
    ] as const) {
      let result: any, error: any;
      await handler('/', 'get')({ user: { role: 'HR_ADMIN', companyId: 'company' }, query }, { json: (data: any) => { result = data; } }, (value: any) => { error = value; });
      assert.equal(error, undefined);
      assert.deepEqual(result.map((record: any) => record.id), expected);
    }
  } finally { employeeService.listForUser = original; }
});
