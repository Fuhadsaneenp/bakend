export function wantsDetailedAnswer(question: string): boolean {
  return /\b(detailed|full report|complete report|breakdown|explain|elaborate)\b|വിശദ|പൂർണ്ണ.*റിപ്പോർട്ട്/i.test(question);
}
export const directAnswerRules = `ANSWER THE QUESTION FIRST:
- For a direct question (who, which, how many, when, most, least, highest, lowest), answer in 1–2 short sentences. No heading, summary section, date banner, department overview, or unrelated employee list.
- Identify the requested person/item and give the exact count or fact that supports the answer.
- Rank by the metric the user asked for. Distinguish jobs published from jobs updated, companies added, and total activities. Name every tied winner. Do not infer performance from workload.
- Respect the requested date/period and company. Do not substitute today's data for historical data.
- Use only supplied live records. If the requested metric or period is missing, say that briefly; never reuse example numbers as real data.
- Follow-up questions retain the previous subject, period and metric unless the user changes them.
- Match the selected language. Names can remain in English. Example style only: “**Employee name** recorded the most entries — **count**.”
- Give a detailed report only when explicitly requested.`;
/** Deterministic reports already contain their answer in Summary; do not add a report wrapper to short replies. */
export function directSummary(report: string): string {
  const summary = report.match(/\*\*Summary:\*\*\s*([\s\S]*?)(?=\n\s*\*\*(?:Detailed Report|Insights|Recommended Actions)|$)/i);
  return (summary?.[1] || report.replace(/^###.*\n+/,'')).trim();
}
