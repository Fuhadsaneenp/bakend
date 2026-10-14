import { calendarDate } from '../../lib/employment.js';
export type QueryKind = 'attendance' | 'tasks' | 'data-entry' | 'kpi' | 'leave' | 'exits' | 'clients' | 'overview';
export interface QueryPlan {
  kind: QueryKind; start: string; end: string; employee?: string; department?: string; category?: 'design' | 'video'; groupByDepartment?: boolean;
  metric: 'summary' | 'count' | 'most' | 'least' | 'missing-checkout' | 'late' | 'early' | 'early-arrival' | 'absent' | 'wfh' | 'leave' | 'pending' | 'overdue' | 'hours' | 'present' | 'approval' | 'not-started';
  compare: boolean; detailed: boolean; publishedOnly: boolean; updatedOnly: boolean; employerOnly: boolean; resignationOnly: boolean; subjectText: string; currentQuestion: string; leaveHistory: boolean; average: boolean;
}
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
function monthBounds(day: string, offset = 0) {
  const d = new Date(day + 'T00:00:00Z');
  return { start: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0)).toISOString().slice(0, 10) };
}
export function resolvePeriod(question: string, now = new Date()): { start: string; end: string } {
  const q = question.toLowerCase(); const today = calendarDate(now);
  const explicit = q.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (explicit?.length) {
    for (const day of explicit) if (Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error('Invalid report date');
    return { start: explicit[0], end: explicit[1] || explicit[0] };
  }
  if (/this month/.test(q) && /compare|with/.test(q)) return { ...monthBounds(today), end: today };
  if (/compare|താരതമ്യം/.test(q) && /today|ഇന്ന്|ഇന്നത്തെ/.test(q)) return { start: today, end: today };
  if (/last month|previous month|കഴിഞ്ഞ മാസം/.test(q) && !/this month|ഈ മാസം/.test(q)) return monthBounds(today, -1);
  if (/this month|monthly|ഈ മാസം/.test(q)) return { ...monthBounds(today), end: today };
  if (/yesterday|ഇന്നലെ|ഇന്നലത്തെ/.test(q)) return { start: shiftDay(today, -1), end: shiftDay(today, -1) };
  if (/week|ആഴ്ച/.test(q)) {
    const d = new Date(today); const monday = shiftDay(today, -((d.getUTCDay() + 6) % 7));
    return /last|previous|കഴിഞ്ഞ/.test(q) ? { start: shiftDay(monday, -7), end: shiftDay(monday, -1) } : { start: monday, end: today };
  }
  const weekday = q.match(/last (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (weekday) {
    const index = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(weekday[1]);
    const diff = (new Date(today).getUTCDay() - index + 7) % 7 || 7;
    const day = shiftDay(today, -diff); return { start: day, end: day };
  }
  return { start: today, end: today };
}
export function planQuestion(question: string, history: { role: string; text: string }[] = [], now = new Date()): QueryPlan {
  // Only earlier user turns provide intent memory. Model output is never an authority source.
  const followup = /^(show a detailed report|show details|what about|and |compare|how about|അപ്പോൾ|കഴിഞ്ഞ മാസം|അത്|അവരുടെ|അയാളുടെ|ഇന്നലെയോ|ഈ മാസമോ)/i.test(question.trim());
  const userTurns = history.filter(turn => turn.role === 'user').slice(-6).map(turn => turn.text);
  const previous = [...userTurns].reverse().find(text => !/^(what about|and |compare|how about)/i.test(text.trim())) || userTurns.at(-1) || '';
  const subject = followup ? `${previous} ${question}` : question;
  const q = subject.toLowerCase();
  const earlyArrival = /(?:early|earlier).*(?:arriv|came|come|check.?in)|(?:arriv|came|come|check.?in).*early|നേരത്തെ.*(?:വന്ന|വര|എത്ത|ചെക്ക് ഇൻ)|(?:വന്ന|എത്ത).*നേരത്തെ|nerathe.*(?:vann|eth)/i.test(question);
  const earlyDeparture = /early.*(?:depart|leav|left|check.?out)|(?:depart|leav|left|check.?out).*early|നേരത്തെ.*(?:പോയ|പോക|പുറപ്പെട്ട|ഇറങ്ങ)|nerathe.*poy/i.test(question);
  const companyOverview = /(?:company|our team|all departments).*(?:status|overview|summary|report)|(?:കമ്പനി|കമ്പനിയുടെ|എല്ലാ വിഭാഗ|നമ്മുടെ ടീം).*(?:സ്ഥിതി|സംഗ്രഹം|റിപ്പോർട്ട്|എന്തൊക്കെ)|ഇന്നത്തെ.*(?:complete|പൂർണ്ണ).*work report/i.test(q);
  const groupByDepartment = /each department|department.*progress|ഓരോ department|ഓരോ വിഭാഗ/.test(q) || (/design|poster|ഡിസൈൻ/.test(q) && /video|reel|വീഡിയോ/.test(q));
  const category = groupByDepartment ? undefined : /video|reel|വീഡിയോ|വീഡിയോകൾ|റീൽ|എഡിറ്റർ/.test(q) ? 'video' as const : /design|poster|creative|ഡിസൈൻ|പോസ്റ്റർ|ഡിസൈനർ/.test(q) ? 'design' as const : undefined;
  const kind: QueryKind = earlyArrival || earlyDeparture ? 'attendance' : companyOverview ? 'overview' : /client|project/.test(q) ? 'clients' : /data\s*entr|ഡാറ്റാ?.*എൻട്രി|ഡേറ്റാ?.*എൻട്രി|entries|records.*add|upload.*job|job.*upload|job.*publish|publish.*job|updat.*job|job.*updat|add.*compan|compan.*add|employer.*entr|ജോബ്|ജോബു/.test(q) ? 'data-entry'
    : /resign|retir|terminat|exit|former|offboard|internship|രാജി/.test(q) ? 'exits'
    : /kpi|performance|best|worst|productiv|compare.*designer|പ്രകടനം/.test(q) ? 'kpi'
    : /leave balance|leave history|ലീവ്/.test(q) ? 'leave'
    : /attend|hours|check.?in|check.?out|absen|late|early depart|\bbreak(?:s| duration)?\b|missing.*record|longest|wfh|home|on leave|worked today|working time|അറ്റൻഡ|മണിക്കൂർ|ഹാജർ|ജോലിക്ക് വന്നു|ഓഫീസ|ലേറ്റ്|വർക്ക് ഫ്രം ഹോം|absent/.test(q) ? 'attendance'
    : /task|work|design|poster|creative|video|reel|pending|overdue|deadline|approval|ടാസ്ക്|ജോലി|ഡിസൈൻ|പോസ്റ്റർ|വീഡിയോ|റീൽ|പെൻഡിംഗ്|അപ്രൂവൽ/.test(q) ? 'tasks' : 'overview';
  const metric: QueryPlan['metric'] = earlyArrival ? 'early-arrival' : earlyDeparture ? 'early' : /not start|yet to start|start ചെയ്യാത്ത|തുടങ്ങാത്ത/.test(q) ? 'not-started' : /await.*approv|waiting.*approv|approval.*wait|അപ്രൂവൽ|approval കാത്തിരി/.test(q) ? 'approval' : /who.*(?:came|present)|ജോലിക്ക് വന്നു|ഹാജരായ|ആരൊക്കെ.*ഓഫീസ|ഓഫീസ.*ആരൊക്കെ/.test(q) ? 'present' : /missing.*check.?out|checkout.*missing/.test(q) ? 'missing-checkout' : /early depart/.test(q) ? 'early' : /late|വൈകി|ലേറ്റ്/.test(q) ? 'late'
    : /absen|ഹാജരാകാത്ത/.test(q) ? 'absent' : /on leave|approved leave|ആരൊക്കെ.*leave|ആരൊക്കെയാണ് leave/.test(q) ? 'leave' : /wfh|home|വർക്ക് ഫ്രം ഹോം/.test(q) ? 'wfh'
    : /overdue|delayed/.test(q) ? 'overdue' : /pending|hasn.t completed|not complet|incomplete|പെൻഡിംഗ്|പൂർത്തിയാകാത്ത/.test(q) ? 'pending'
    : /lowest|least|worst|കുറവ്|കുറഞ്ഞ/.test(q) ? 'least' : /most|highest|best|longest|കൂടുതൽ/.test(q) ? 'most'
    : /hours|working time|മണിക്കൂർ/.test(q) ? 'hours' : /how many|count|എത്ര/.test(q) ? 'count' : 'summary';
  const employee = /\b(my|me)\b/.test(q) && !/\bmy (?:team|department)\b/.test(q) ? 'me' : undefined;
  const department = q.match(/\b(design|video edit(?:ing)?|data entry|development|marketing|seo|hr)\s+(?:team|department)/)?.[1];
  const timeWords = /today|yesterday|month|week|last (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|ഇന്നലെ|ഇന്ന്|ഇന്നത്തെ|മാസം|ആഴ്ച/;
  const rememberedPeriod = [...userTurns].reverse().find(text => timeWords.test(text.toLowerCase()));
  const comparisonFollowup = /^(compare with|compare to)/i.test(question.trim());
  const periodText = comparisonFollowup && rememberedPeriod ? rememberedPeriod : timeWords.test(question.toLowerCase()) ? question : followup ? rememberedPeriod || subject : question;
  const period = resolvePeriod(periodText, now);
  if (period.start > period.end || Date.parse(period.end) - Date.parse(period.start) > 366 * 86400000) throw new Error('Choose a report period of at most one year');
  return { kind, ...period, subjectText: subject, currentQuestion: question, employee: companyOverview ? undefined : employee, department: groupByDepartment ? undefined : department, category, groupByDepartment, metric: groupByDepartment ? "summary" : metric, average: /average|mean|ശരാശരി/.test(q), resignationOnly: /resign|രാജി/.test(q), leaveHistory: /leave history|leave.*(?:last|yesterday|month|week)|ലീവ്.*ചരിത്രം/.test(q), compare: /(?:compare.*(?:month|week|yesterday|previous)|decrease|improv|താരതമ്യം|ഇന്നലത്തെയും.*ഇന്നത്തെയും|കഴിഞ്ഞ ആഴ്ചയേക്കാൾ)/.test(question.toLowerCase()), detailed: /report|breakdown|detail|explain|compare|what happened|റിപ്പോർട്ട്|വിശദ/.test(q), publishedOnly: /publish|പ്രസിദ്ധീകര/.test(q), updatedOnly: /updat.*job|job.*updat/.test(q), employerOnly: /compan.*(?:add|entr)|add.*compan|employer.*entr/.test(q) };
}
export function previousPeriod(plan: Pick<QueryPlan, 'start' | 'end'>) {
  const days = Math.round((Date.parse(plan.end) - Date.parse(plan.start)) / 86400000) + 1;
  if (plan.start.endsWith('-01') && days >= 28) return monthBounds(plan.start, -1);
  if (plan.start.endsWith('-01') && days > 7) { const previous = monthBounds(plan.start, -1); return { start: previous.start, end: shiftDay(previous.start, Math.min(days, Number(previous.end.slice(-2))) - 1) }; }
  return { start: shiftDay(plan.start, -days), end: shiftDay(plan.start, -1) };
}
