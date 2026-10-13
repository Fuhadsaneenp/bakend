import type { AIResponsePayload, UserContext } from "./ai.types.js";
import type { StemsLiveContext } from "./stems-context.service.js";

const statusLabel = (status: string, ml: boolean) => ml ? ({ IN_PROGRESS: "നടന്നുകൊണ്ടിരിക്കുന്നു", PENDING: "തുടങ്ങാനുണ്ട്", DELAYED: "വൈകിയിരിക്കുന്നു", REWORK: "വീണ്ടും ചെയ്യാനുണ്ട്", FINISHED: "പൂർത്തിയായി", APPROVED: "അംഗീകരിച്ചു", COMPLETED: "പൂർത്തിയായി" } as Record<string, string>)[status] || status : status.replaceAll("_", " ");
const finished = (status: string) => ["FINISHED", "APPROVED", "COMPLETED"].includes(status);
export function buildDirectAnswer(ctx: StemsLiveContext, user: UserContext, question: string, language: string, history: { role: string; text: string }[] = []): AIResponsePayload {
  const ml = language === "ml";
  const q = question.toLowerCase();
  const say = (malayalam: string, english: string) => ml ? malayalam : english;
  const result = (text: string, spoken = text): AIResponsePayload => ({ intent: "GENERAL_WORKPLACE_QUERY", markdown: text, spokenReply: spoken, metrics: { source: "live_database", retrievedAt: ctx.retrievedAt, provider: "direct_records" }, suggestedFollowUps: [] });
  if (!ctx.dataAvailable) return result(say("സെർവർ വിവരങ്ങൾ ഇപ്പോൾ ലഭ്യമല്ല. വീണ്ടും ശ്രമിക്കൂ.", "Server records are unavailable. Please try again."));
  let employee = ctx.employeesDirectory.find(e => q.includes(e.name.toLowerCase()) || e.code?.length > 1 && q.includes(e.code.toLowerCase()));
  if (!employee && /\b(his|her|their)\b|അവന്റെ|അവളുടെ|അവരുടെ/.test(q)) {
    for (const turn of [...history].reverse()) { employee = ctx.employeesDirectory.find(e => turn.text.toLowerCase().includes(e.name.toLowerCase())); if (employee) break; }
  }
  const mine = /\b(my|mine)\b|എന്റെ/.test(q);
  if (mine) employee = ctx.employeesDirectory.find(e => e.id === user.employeeId);
  if (mine && !employee) return result(say("നിങ്ങളുടെ അക്കൗണ്ടുമായി ബന്ധിപ്പിച്ച ജീവനക്കാരന്റെ വിവരങ്ങൾ ലഭ്യമല്ല.", "No employee record linked to your account is available."));
  if (/\b(month|monthly|year|yesterday|last week)\b|മാസം|മാസത്തെ|ഇന്നലെ|കഴിഞ്ഞ/.test(q)) return result(say("ഈ നേരിട്ടുള്ള സേവനത്തിൽ ഇന്നത്തെ ഹാജറും നിലവിലെ ടാസ്കുകളുമാണ് ലഭിക്കുന്നത്. മാസ റിപ്പോർട്ട് Attendance പേജിൽ പരിശോധിക്കൂ.", "Direct answers currently cover today's attendance and current tasks. Check the Attendance page for historical reports."));
  if (/attendance|present|absent|leave|ഹാജ|വന്ന|ലീവ്|അവധി/.test(q)) {
    if (employee) {
      const present = ctx.attendance.presentEmployees.find(e => e.name === employee!.name);
      const wfh = ctx.attendance.wfhEmployees.some(e => e.name === employee!.name);
      const leave = ctx.attendance.onLeaveEmployees.some(e => e.name === employee!.name);
      return result(`${employee.name}: ${present ? say(`ഇന്ന് ഹാജർ രേഖപ്പെടുത്തിയിട്ടുണ്ട്.`, "Attendance recorded today.") : wfh ? say("ഇന്ന് വീട്ടിൽ നിന്ന് ജോലി ചെയ്യാൻ അനുമതിയുണ്ട്.", "Approved to work from home today.") : leave ? say("ഇന്ന് അവധിയിലാണ്.", "On leave today.") : say("ഇന്നത്തെ ഹാജർ രേഖ കണ്ടെത്തിയില്ല.", "No attendance record found for today.")}`);
    }
    const list = /absent|വരാത്ത|ഹാജരില്ല/.test(q) ? ctx.attendance.absentEmployees : ctx.attendance.presentEmployees;
    const summary = say(`ഇന്ന് ${ctx.attendance.totalEmployees} ജീവനക്കാരിൽ ${ctx.attendance.presentCount} പേരുടെ ഹാജർ രേഖപ്പെടുത്തിയിട്ടുണ്ട്. ${ctx.attendance.wfhCount} പേർക്ക് വീട്ടിൽ നിന്ന് ജോലി ചെയ്യാൻ അനുമതിയുണ്ട്; ${ctx.attendance.onLeaveCount} പേർ അവധിയിലാണ്.`, `Today, attendance is recorded for ${ctx.attendance.presentCount} of ${ctx.attendance.totalEmployees} employees. ${ctx.attendance.wfhCount} have approved work from home and ${ctx.attendance.onLeaveCount} are on leave.`);
    return result(`${summary}\n\n${list.slice(0, 20).map(e => `• ${e.name}`).join("\n")}`, summary);
  }
  if (/company|overview|summary|കമ്പനി|സ്ഥിതി/.test(q) && !employee) {
    const text = say(`ഇന്ന് ${ctx.attendance.presentCount} പേരുടെ ഹാജർ രേഖപ്പെടുത്തിയിട്ടുണ്ട്. നിലവിൽ ${ctx.tasks.inProgressCount} ടാസ്കുകൾ നടന്നുകൊണ്ടിരിക്കുന്നു; ${ctx.tasks.pendingCount} ടാസ്കുകൾ തുടങ്ങാനുണ്ട്. ${ctx.clients.totalClients} ക്ലയന്റുകളുടെ രേഖകൾ ലഭ്യമാണ്.`, `Today, attendance is recorded for ${ctx.attendance.presentCount} people. Currently ${ctx.tasks.inProgressCount} tasks are in progress and ${ctx.tasks.pendingCount} are pending. Records for ${ctx.clients.totalClients} clients are available.`);
    return result(text);
  }
  if (/client|ക്ലയന്റ്/.test(q) && !/task|ടാസ്ക്|ജോലി/.test(q)) return result(say(`${ctx.clients.totalClients} ക്ലയന്റുകളുടെ രേഖകൾ ലഭ്യമാണ്: `, `${ctx.clients.totalClients} client records are available: `) + ctx.clients.activeClients.slice(0, 15).map(c => c.name).join(", "));
  if (/task|work|doing|deadline|pending|overdue|ടാസ്ക|ജോലി|വർക്ക്|ചെയ്യ|ബാക്കി|വൈകി/.test(q) || employee) {
    let tasks = ctx.taskRecords.filter(t => !employee || t.assignedTo === employee.name);
    if (/pending|ബാക്കി|തുടങ്ങ/.test(q)) tasks = tasks.filter(t => !finished(t.status));
    if (/in.progress|working|doing|നടന്നുകൊണ്ട|ചെയ്യുന്നു|ചെയ്യുന്ന/.test(q)) tasks = tasks.filter(t => t.status === "IN_PROGRESS");
    if (/completed|finished|പൂർത്തി/.test(q)) tasks = tasks.filter(t => finished(t.status));
    if (/overdue|delayed|വൈകി/.test(q)) tasks = tasks.filter(t => !finished(t.status) && (t.status === "DELAYED" || Number.isFinite(Date.parse(t.deadline)) && Date.parse(t.deadline) < Date.now()));
    tasks.sort((a, b) => Number(b.status === "IN_PROGRESS") - Number(a.status === "IN_PROGRESS") || b.updatedAt.localeCompare(a.updatedAt));
    if (!tasks.length) return result(say("അനുമതിയുള്ള സെർവർ രേഖകളിൽ ഈ ചോദ്യത്തിന് യോജിക്കുന്ന ടാസ്കുകൾ കണ്ടെത്തിയില്ല.", "No matching tasks were found in the server records you can access."));
    const shown = tasks.slice(0, 10);
    const lead = say(`${tasks.length} ടാസ്കുകൾ കണ്ടെത്തി${tasks.length > shown.length ? `; ആദ്യത്തെ ${shown.length} കാണിക്കുന്നു` : ""}. ഇവ സെർവറിൽ രേഖപ്പെടുത്തിയ സ്റ്റാറ്റസുകളാണ്.`, `Found ${tasks.length} tasks${tasks.length > shown.length ? `; showing the first ${shown.length}` : ""}. These are recorded statuses.`);
    const line = (t: typeof tasks[number]) => `${t.assignedTo}: ${t.title} — ${statusLabel(t.status, ml)}${/deadline|ഡെഡ്|അവസാന/.test(q) ? ` (${Number.isFinite(Date.parse(t.deadline)) ? new Date(t.deadline).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : say("അവസാന തീയതി രേഖപ്പെടുത്തിയിട്ടില്ല", "no deadline recorded")})` : ""}`;
    return result(`${lead}\n\n${shown.map(t => `• ${line(t)}`).join("\n")}`, `${lead} ${shown.slice(0, 3).map(line).join(". ")}.`);
  }
  return result(say("ഹാജർ, ജീവനക്കാരുടെ ടാസ്കുകൾ, ബാക്കിയുള്ള ജോലി, അവസാന തീയതികൾ, കമ്പനിയുടെ ഇന്നത്തെ സ്ഥിതി എന്നിവ നേരിട്ട് പരിശോധിക്കാം. ഇവയിൽ എന്താണ് അറിയേണ്ടത്?", "I can check attendance, employee tasks, pending work, deadlines, and today's company overview directly. Which would you like?"));
}
