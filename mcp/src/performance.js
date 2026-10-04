const dateKey = value => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};
const nameOf = employee => [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' ');
const normalizeName = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
const sum = (rows, field) => rows.reduce((total, row) => total + (Number.isFinite(Number(row[field])) ? Number(row[field]) : 0), 0);

export function buildPerformanceReport({ employees, attendance, cards, sheets, workCompanyId, month, year, employeeId, sourceStatus }) {
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const inMonth = value => dateKey(value)?.startsWith(period) === true;
  const selected = employeeId ? employees.filter(e => e.id === employeeId) : employees;
  if (employeeId && !selected.length) throw new Error('Employee not found in the employees visible to this account.');
  const names = new Map();
  for (const employee of employees) {
    const name = normalizeName(nameOf(employee));
    names.set(name, (names.get(name) || 0) + 1);
  }
  const sheetRows = Object.entries(sheets || {}).flatMap(([sheet, rows]) =>
    Array.isArray(rows) ? rows.map(row => ({ sheet, ...row })) : []);
  return {
    period: { month, year, timezone: 'Asia/Kolkata' },
    collectedAt: new Date().toISOString(),
    sourceStatus,
    workTrackCompanyId: workCompanyId,
    limitations: [
      'Attendance punches describe office attendance, not task start/end times. Individual intermediate biometric punches are not exposed by the monthly report.',
      'Designer start/finish timestamps are status-history proxies, not measured active work time. Multiple work/rework rounds are retained in statusHistory.',
      'Dated data-entry activity is grouped using row dates or dates encoded in sheet keys. Undated rows are kept separately. Publication/edit activity is not an exact work timer. Row count is not the sum of the sheet count column, which is a row number.',
      'Reports cover records returned by the backend for this account. Source errors are explicit; missing data is not treated as zero.',
    ],
    employees: selected.map(employee => {
      const workScopeMatches = Boolean(workCompanyId && employee.companyId === workCompanyId);
      const punches = attendance === null ? null : attendance.filter(row => row.employeeId === employee.id && inMonth(row.workDate)).map(row => ({
        workDate: row.workDate, localDate: dateKey(row.workDate), punchIn: row.checkInAt ?? null, punchOut: row.checkOutAt ?? null,
        workMinutes: row.workMinutes ?? null, overtimeMinutes: row.overtimeMinutes ?? null,
        isLate: row.isLate ?? null, isEarlyLeave: row.isEarlyLeave ?? null,
      }));
      const tasks = cards === null || !workScopeMatches ? null : cards.filter(card => card.assignedToId === employee.id &&
        (inMonth(card.createdAt) || (card.statusHistory || []).some(event => inMonth(event.createdAt))))
        .map(card => {
          const history = [...(card.statusHistory || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          const started = history.find(event => event.status === 'IN_PROGRESS');
          const finished = history.find(event => event.status === 'FINISHED' && started && new Date(event.createdAt) >= new Date(started.createdAt));
          return {
            id: card.id, workId: card.workId, title: card.title, category: card.category, status: card.status,
            createdAt: card.createdAt, deadline: card.deadline, reworkCount: card.reworkCount ?? null, pointsEarned: card.pointsEarned ?? null,
            workStartTime: started?.createdAt ?? null, workEndTime: finished?.createdAt ?? null,
            timingSource: 'status_history_proxy', activeWorkMinutes: null,
            statusHistory: history.map(event => ({ status: event.status, timestamp: event.createdAt })),
            reworkLogs: (card.reworkLogs || []).map(log => ({ roundNumber: log.roundNumber, reason: log.reason, createdAt: log.createdAt })),
          };
        });
      const name = normalizeName(nameOf(employee));
      const ambiguous = (names.get(name) || 0) > 1;
      const entries = sheets === null || !workScopeMatches ? null : sheetRows.filter(row => row.employeeId === employee.id || row.sheet.endsWith(`-${employee.id}`) ||
        (!ambiguous && normalizeName(row.employeeName || row.uploadedBy) === name));
      const deduped = entries === null ? null : [...new Map(entries.map((row, index) => {
        const day = row.date || row.sheet.match(/\d{4}-\d{2}-\d{2}/)?.[0] || dateKey(row.uploadedAt || row.createdAt);
        const identity = row.postId ?? row.sourceUrl;
        const brand = row.sheet.split(/-(?:Jobs|Employer)-/)[0];
        return [identity ? `${brand}:${identity}:${day || 'undated'}:${row.activityType || 'created'}` : `${row.sheet}:${index}`, { ...row, activityDate: day || null }];
      })).values()];
      const monthlyEntries = deduped?.filter(row => row.activityDate?.startsWith(period)) || [];
      const undatedEntries = deduped?.filter(row => !row.activityDate) || [];
      return {
        employee: { id: employee.id, employeeCode: employee.employeeCode, name: nameOf(employee),
          designation: employee.designation?.title ?? employee.designation ?? null,
          department: employee.department?.name ?? employee.department ?? null },
        attendance: punches === null ? null : { recordedDays: punches.length, workMinutes: sum(punches, 'workMinutes'),
          overtimeMinutes: sum(punches, 'overtimeMinutes'), lateDays: punches.filter(row => row.isLate === true).length,
          earlyLeaveDays: punches.filter(row => row.isEarlyLeave === true).length, daily: punches },
        work: tasks === null ? null : { scope: 'Tasks created or with status changes during the requested month; current statuses and lifetime histories included.',
          taskCount: tasks.length, approvedDuringMonth: tasks.filter(task => task.statusHistory.some(event => event.status === 'APPROVED' && inMonth(event.timestamp))).length,
          tasks },
        workUnavailableReason: !workScopeMatches ? 'Work-track APIs use the token company; employee company differs or account company could not be verified.' : cards === null ? 'Source unavailable.' : null,
        dataEntry: entries === null ? { available: false, reason: !workScopeMatches ? 'Work-track company does not match or could not be verified.' : 'Source unavailable.' }
          : { available: true, scope: 'dated_monthly_activity_and_separate_undated_snapshot', attribution: 'employee_id_or_sheet_suffix_then_unique_normalized_name',
            monthlyRowCount: monthlyEntries.length, monthlyReportedJobCount: sum(monthlyEntries, 'jobCount'),
            undatedRowCount: undatedEntries.length, undatedReportedJobCount: sum(undatedEntries, 'jobCount'),
            duplicateNameAttributionSkipped: ambiguous,
            rowsWithoutNumericJobCount: [...monthlyEntries, ...undatedEntries].filter(row => row.jobCount === '' || row.jobCount == null || !Number.isFinite(Number(row.jobCount))).length,
            workStartTime: null, workEndTime: null, rows: monthlyEntries, undatedRows: undatedEntries },
      };
    }),
    unattributedDataEntryRows: sheets === null ? null : sheetRows.filter(row => !names.has(normalizeName(row.employeeName)) || names.get(normalizeName(row.employeeName)) !== 1).length,
  };
}
