export const sources = ["Automatic from STMS", "Work tracker API", "Task/project data", "Manual entry", "Manager review", "External API", "Calculated metric"] as const;
export type Metric = { id: string; name: string; weight: number; source: typeof sources[number]; calculation: string; minimum: number };
export type Template = { departmentId: string; metrics: Metric[] };
export type Band = { minimum: number; label: string };
export const defaultBands: Band[] = [{ minimum: 90, label: "Excellent" }, { minimum: 80, label: "Very Good" }, { minimum: 70, label: "Good" }, { minimum: 60, label: "Needs Improvement" }, { minimum: 0, label: "Performance Review Required" }];
const completedStatuses = new Set(["FINISHED", "OUT_TO_DELIVER", "APPROVED"]);
export const isDone = (status: string) => completedStatuses.has(status);
export const dayKey = (date: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
export const percentage = (a: number, b: number) => b > 0 ? Math.round(a / b * 10000) / 100 : null;
export function completionAt(card: any): Date | null {
  if (!isDone(card.status)) return null;
  const histories = [...(card.statusHistory || [])].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  let completed: Date | null = null;
  for (const event of histories) {
    if (isDone(event.status)) { if (!completed) completed = new Date(event.createdAt); }
    else completed = null;
  }
  return completed;
}
export function taskStats(cards: any[], from: Date, until: Date, now = new Date()) {
  const cutoff = new Date(Math.min(+now, +until));
  const periodCards = cards.map(card => {
    const history = (card.statusHistory || []).filter((event: any) => new Date(event.createdAt) < until);
    const previous = history.at(-1);
    return { ...card, statusHistory: history, status: previous?.status || (new Date(card.updatedAt || card.createdAt) < until ? card.status : "UNKNOWN"), reworkCount: new Date(card.updatedAt || card.createdAt) < until ? card.reworkCount : history.filter((event: any) => event.status === "REWORK").length };
  });
  const relevant = periodCards.filter(card => {
    const ended = completionAt(card);
    return new Date(card.createdAt) < until && (!ended || ended >= from);
  });
  const finished = relevant.filter(card => { const at = completionAt(card); return at && at >= from && at < until; });
  const missingHistory = relevant.filter(card => card.status === "UNKNOWN" || (isDone(card.status) && !completionAt(card))).length;
  const pending = relevant.filter(card => card.status !== "UNKNOWN" && !isDone(card.status));
  const withDeadline = finished.filter(card => card.deadline);
  const onTime = withDeadline.filter(card => completionAt(card)! <= new Date(card.deadline));
  const durations = finished.map(card => {
    const started = (card.statusHistory || []).find((h: any) => h.status === "IN_PROGRESS");
    return started ? Math.max(0, (+completionAt(card)! - +new Date(started.createdAt)) / 3600000) : null;
  }).filter((value): value is number => value !== null);
  return { assigned: relevant.length, started: relevant.filter(card => (card.statusHistory || []).some((h: any) => h.status === "IN_PROGRESS" && new Date(h.createdAt) >= from && new Date(h.createdAt) < until)).length,
    completed: finished.length, pending: pending.length, overdue: pending.filter(card => new Date(card.deadline) < cutoff).length,
    reopened: relevant.filter(card => (card.statusHistory || []).some((h: any) => h.status === "REWORK" && new Date(h.createdAt) >= from && new Date(h.createdAt) < until)).length,
    beforeDeadline: onTime.length, afterDeadline: withDeadline.length - onTime.length,
    missingHistory, completion: missingHistory ? null : percentage(finished.length, relevant.length), adherence: missingHistory ? null : percentage(onTime.length, withDeadline.length),
    averageCompletionHours: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length * 100) / 100 : null,
    reworkRate: missingHistory ? null : percentage(relevant.filter(card => card.reworkCount > 0).length, relevant.length), relevant, finished };
}
export function evaluate(template: Template | null, stats: ReturnType<typeof taskStats>, attendance: any[], inputs: Record<string, number>, review: any, bands: Band[]) {
  if (!template) return { score: null, label: "KPI template not configured", coverage: 0, metrics: [] };
  const reviewValues = review ? Object.values(review.ratings) as number[] : [];
  const metrics = template.metrics.map(metric => {
    let value: number | null = null;
    if (metric.source === "Manager review") value = reviewValues.length ? reviewValues.reduce((a, b) => a + b, 0) / reviewValues.length : null;
    else if (["Manual entry", "External API"].includes(metric.source)) value = inputs[metric.id] ?? null;
    else {
      switch (metric.calculation) {
        case "task_completion": value = stats.completion; break;
        case "deadline_adherence": value = stats.adherence; break;
        case "first_pass": value = stats.reworkRate === null ? null : 100 - stats.reworkRate; break;
        case "work_discipline": value = percentage(attendance.filter(row => row.checkInAt && !row.isLate && !row.isEarlyLeave && row.checkOutAt).length, attendance.filter(row => row.checkInAt).length); break;
        // Activity hours, revenue and traffic are never invented when a source is unavailable.
        default: value = inputs[metric.id] ?? null;
      }
    }
    if (value !== null) value = Math.max(0, Math.min(100, value));
    return { ...metric, value, contribution: value === null ? null : Math.round(value * metric.weight) / 100 };
  });
  const coverage = metrics.filter(metric => metric.value !== null).reduce((sum, metric) => sum + metric.weight, 0);
  const score = Math.abs(coverage - 100) < 0.001 ? Math.round(metrics.reduce((sum, metric) => sum + (metric.contribution || 0), 0) * 100) / 100 : null;
  return { score, label: score === null ? "Awaiting KPI data" : [...bands].sort((a, b) => b.minimum - a.minimum).find(band => score >= band.minimum)?.label || "Unclassified", coverage, metrics };
}
export function flagsFor(stats: ReturnType<typeof taskStats>, attendance: any[], result: ReturnType<typeof evaluate>, today: string) {
  const flags: string[] = [];
  if (attendance.filter(row => row.isLate).length >= 3) flags.push("Repeated late check-ins");
  if (attendance.filter(row => row.checkInAt && !row.checkOutAt && dayKey(row.workDate) < today).length >= 2) flags.push("Frequent missing checkout");
  if (stats.overdue >= 3) flags.push("High overdue task count");
  if (stats.completion !== null && stats.assigned >= 5 && stats.completion < 60) flags.push("Low task completion");
  if (stats.reworkRate !== null && stats.assigned >= 5 && stats.reworkRate > 30) flags.push("Excessive rework");
  if (stats.adherence !== null && stats.completed >= 5 && stats.adherence < 70) flags.push("Consistently missed deadlines");
  result.metrics.filter(metric => metric.value !== null && metric.value < metric.minimum).forEach(metric => flags.push(`${metric.name} below minimum`));
  return flags;
}
