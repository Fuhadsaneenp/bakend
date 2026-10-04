import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

async function withClient(options, run) {
  const server = createServer(options);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await run(client); } finally { await client.close(); await server.close(); }
}

test('MCP discovery and health do not send account credentials', async () => {
  await withClient({ token: 'test-only', fetchImpl: async (url, options) => {
    assert.equal(url.href, 'https://api.secondtales.com/health');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    return Response.json({ ok: true, database: 'connected' });
  } }, async client => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['stems_health', 'stems_list_employees', 'stems_list_notifications', 'stems_employee_performance']);
    const result = await client.callTool({ name: 'stems_health', arguments: {} });
    assert.equal(JSON.parse(result.content[0].text).ok, true);
  });
});

test('authenticated tools fail before network access without a token', async () => {
  await withClient({ token: '', fetchImpl: () => assert.fail('Must not fetch') }, async client => {
    const result = await client.callTool({ name: 'stems_list_employees', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /STEMS_ACCESS_TOKEN/);
  });
});

test('employee requests preserve the fixed endpoint, token, and encoded company query', async () => {
  await withClient({ token: 'test-only', fetchImpl: async (url, options) => {
    assert.equal(url.pathname, '/api/employees');
    assert.equal(url.searchParams.get('companyId'), 'company & one');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    assert.equal(options.method, 'GET');
    return Response.json([]);
  } }, async client => {
    const result = await client.callTool({ name: 'stems_list_employees', arguments: { companyId: 'company & one' } });
    assert.deepEqual(JSON.parse(result.content[0].text), []);
  });
});

test('expired tokens produce a useful error without exposing response bodies', async () => {
  await withClient({ token: 'test-only', fetchImpl: async () => new Response('private details', { status: 401 }) }, async client => {
    const result = await client.callTool({ name: 'stems_list_notifications', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /expired or invalid/);
    assert.doesNotMatch(result.content[0].text, /private details/);
  });
});

test('insecure remote origins and embedded credentials are rejected', () => {
  assert.throws(() => createServer({ baseUrl: 'http://example.com' }), /HTTPS/);
  assert.throws(() => createServer({ baseUrl: 'https://user:secret@example.com' }), /credentials/);
});

test('performance aggregates monthly attendance, task history, and undated entry counts', async () => {
  const responses = {
    '/api/employees': [{ id: 'e1', companyId: 'c1', firstName: 'Asha', lastName: 'K', designation: { title: 'Data Entry' } }],
    '/api/auth/me/access': { user: { companyId: 'c1' } },
    '/api/attendance/report': [{ employeeId: 'e1', workDate: '2026-09-30T18:30:00Z', checkInAt: '2026-10-01T03:30:00Z', workMinutes: 480, isLate: true }],
    '/api/work-track/cards': [{ id: 'task', assignedToId: 'e1', createdAt: '2026-09-20T00:00:00Z', status: 'APPROVED', statusHistory: [
      { status: 'IN_PROGRESS', createdAt: '2026-10-01T04:00:00Z' },
      { status: 'FINISHED', createdAt: '2026-10-01T05:00:00Z' },
      { status: 'APPROVED', createdAt: '2026-10-01T06:00:00Z' },
    ] }],
    '/api/work-track/data-entry-sheets': { sheet: [{ employeeName: 'Asha K', count: 99, jobCount: 5 }, { employeeName: 'Asha K', count: 100, jobCount: '' }] },
  };
  await withClient({ token: 'test-only', fetchImpl: async url => {
    assert.ok(Object.hasOwn(responses, url.pathname));
    if (url.pathname === '/api/attendance/report') assert.equal(url.searchParams.get('month'), '10');
    return Response.json(responses[url.pathname]);
  } }, async client => {
    const result = await client.callTool({ name: 'stems_employee_performance', arguments: { month: 10, year: 2026, employeeId: 'e1' } });
    assert.ok(!result.isError);
    const report = JSON.parse(result.content[0].text);
    const employee = report.employees[0];
    assert.equal(employee.attendance.recordedDays, 1);
    assert.equal(employee.attendance.daily[0].localDate, '2026-10-01');
    assert.equal(employee.attendance.workMinutes, 480);
    assert.equal(employee.work.tasks[0].workStartTime, '2026-10-01T04:00:00Z');
    assert.equal(employee.work.tasks[0].activeWorkMinutes, null);
    assert.equal(employee.work.approvedDuringMonth, 1);
    assert.equal(employee.dataEntry.undatedRowCount, 2);
    assert.equal(employee.dataEntry.undatedReportedJobCount, 5);
    assert.equal(employee.dataEntry.rowsWithoutNumericJobCount, 1);
    assert.equal(employee.dataEntry.monthlyRowCount, 0);
  });
});

test('performance preserves denied sources and does not confuse companies', async () => {
  await withClient({ token: 'test-only', fetchImpl: async url => {
    if (url.pathname === '/api/employees') return Response.json([{ id: 'e1', companyId: 'other', firstName: 'Asha' }]);
    if (url.pathname === '/api/auth/me/access') return Response.json({ user: { companyId: 'c1' } });
    if (url.pathname === '/api/attendance/report') return new Response('', { status: 403 });
    if (url.pathname === '/api/work-track/cards') return Response.json([]);
    return Response.json({ sheet: [{ employeeName: 'Asha', jobCount: 100 }] });
  } }, async client => {
    const result = await client.callTool({ name: 'stems_employee_performance', arguments: { month: 10, year: 2026 } });
    const report = JSON.parse(result.content[0].text);
    assert.equal(report.sourceStatus.attendance.available, false);
    assert.equal(report.employees[0].attendance, null);
    assert.equal(report.employees[0].work, null);
    assert.equal(report.employees[0].dataEntry.available, false);
  });
});
