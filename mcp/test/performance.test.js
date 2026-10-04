import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformanceReport } from '../src/performance.js';

test('duplicate names are never used to allocate data-entry counts', () => {
  const report = buildPerformanceReport({
    employees: [{ id: 'one', companyId: 'c', firstName: 'Asha' }, { id: 'two', companyId: 'c', firstName: 'Asha' }],
    attendance: [], cards: [], sheets: { sheet: [{ employeeName: 'Asha', jobCount: 12 }] },
    workCompanyId: 'c', month: 10, year: 2026, sourceStatus: {},
  });
  assert.equal(report.unattributedDataEntryRows, 1);
  assert.ok(report.employees.every(employee => employee.dataEntry.duplicateNameAttributionSkipped && employee.dataEntry.monthlyRowCount === 0 && employee.dataEntry.undatedRowCount === 0));
});

test('dated WordPress employee sheets deduplicate shared and personal activity rows', () => {
  const row = { postId: 3, uploadedBy: 'Asha', jobCount: 1, date: '2026-10-01', activityType: 'created' };
  const report = buildPerformanceReport({ employees: [{ id: 'one', companyId: 'c', firstName: 'Asha' }],
    attendance: [], cards: [], sheets: { 'Medbiomate-Jobs-2026-10-01': [row], 'Medbiomate-Jobs-2026-10-01-one': [row] },
    workCompanyId: 'c', month: 10, year: 2026, sourceStatus: {} });
  assert.equal(report.employees[0].dataEntry.monthlyRowCount, 1);
  assert.equal(report.employees[0].dataEntry.monthlyReportedJobCount, 1);
});

test('created and updated timestamps do not fabricate work start or completion', () => {
  const report = buildPerformanceReport({
    employees: [{ id: 'one', companyId: 'c', firstName: 'Asha' }], attendance: [], sheets: {},
    cards: [{ id: 'task', assignedToId: 'one', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', status: 'APPROVED' }],
    workCompanyId: 'c', month: 10, year: 2026, sourceStatus: {},
  });
  const task = report.employees[0].work.tasks[0];
  assert.equal(task.workStartTime, null);
  assert.equal(task.workEndTime, null);
  assert.equal(report.employees[0].work.approvedDuringMonth, 0);
});
