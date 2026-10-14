import type { VerifiedReport } from './verified-analytics.service.js';
const labels: Record<string,string> = {
 employees:'റിപ്പോർട്ടിൽ ഉൾപ്പെട്ട ജീവനക്കാർ', checkedIn:'ചെക്ക് ഇൻ ചെയ്തവർ', approvedWfh:'അനുമതിയുള്ള വർക്ക് ഫ്രം ഹോം', approvedLeave:'അനുമതിയുള്ള ലീവ്', noAttendanceRecord:'ഹാജർ രേഖ കണ്ടെത്താത്തവർ', lateRecords:'വൈകിയെത്തിയതായി രേഖപ്പെടുത്തിയ എൻട്രികൾ', missingCheckouts:'ചെക്ക് ഔട്ട് ഇല്ലാത്ത എൻട്രികൾ', earlyDepartureRecords:'നേരത്തെ പോയതായി രേഖപ്പെടുത്തിയ എൻട്രികൾ', assignedTasks:'ഈ കാലയളവിൽ നൽകിയ ടാസ്കുകൾ', completedTasks:'പൂർത്തിയാക്കിയ ടാസ്കുകൾ', approvedTasks:'അപ്രൂവ് ചെയ്ത ടാസ്കുകൾ', pendingTasks:'പൂർത്തിയാകാനുള്ള ടാസ്കുകൾ', overdueTasks:'ഡെഡ്‌ലൈൻ കഴിഞ്ഞ ടാസ്കുകൾ', awaitingApproval:'അപ്രൂവൽ കാത്തിരിക്കുന്ന ടാസ്കുകൾ', notStartedTasks:'തുടങ്ങാത്ത ടാസ്കുകൾ', recordedHours:'രേഖപ്പെടുത്തിയ ജോലി സമയം (മണിക്കൂർ)', activities:'രേഖപ്പെടുത്തിയ എൻട്രികൾ', leaveRequests:'ലീവ് അപേക്ഷകൾ', normalizedApprovedWorkload:'അംഗീകൃത നിയമപ്രകാരം കണക്കാക്കിയ ജോലിയുടെ അളവ്'
};
const units: Record<string,string> = {
 'recorded attendance hours':'മണിക്കൂർ രേഖപ്പെടുത്തിയ ജോലി സമയം', 'average recorded hours per complete attendance record':'മണിക്കൂർ ശരാശരി രേഖപ്പെടുത്തിയ സമയം', 'completed tasks':'പൂർത്തിയാക്കിയ ടാസ്കുകൾ', 'pending tasks':'പൂർത്തിയാകാനുള്ള ടാസ്കുകൾ', 'overdue tasks':'ഡെഡ്‌ലൈൻ കഴിഞ്ഞ ടാസ്കുകൾ', 'tasks awaiting approval':'അപ്രൂവൽ കാത്തിരിക്കുന്ന ടാസ്കുകൾ', 'tasks not started':'തുടങ്ങാത്ത ടാസ്കുകൾ', 'employees checked in':'ചെക്ക് ഇൻ', 'late attendance records':'വൈകിയെത്തിയ എൻട്രികൾ', 'early departure records':'നേരത്തെ പോയ എൻട്രികൾ', 'missing checkout records':'ചെക്ക് ഔട്ട് ഇല്ലാത്ത എൻട്രികൾ', 'employees with no attendance record':'ഹാജർ രേഖ കണ്ടെത്തിയില്ല', 'employees on approved leave':'അനുമതിയുള്ള ലീവ്', 'employees with approved WFH':'അനുമതിയുള്ള വർക്ക് ഫ്രം ഹോം', 'pending client deliverables':'പൂർത്തിയാകാനുള്ള ക്ലയന്റ് ജോലികൾ', 'overdue client deliverables':'ഡെഡ്‌ലൈൻ കഴിഞ്ഞ ക്ലയന്റ് ജോലികൾ', 'client deliverables awaiting approval':'അപ്രൂവൽ കാത്തിരിക്കുന്ന ക്ലയന്റ് ജോലികൾ', 'completed client deliverables':'പൂർത്തിയാക്കിയ ക്ലയന്റ് ജോലികൾ', 'approved appraisal score':'അംഗീകൃത അപ്രൈസൽ സ്കോർ', 'leave request':'ലീവ് അപേക്ഷ'
};
const titles: Record<string,string> = { overview:'കമ്പനിയുടെ പ്രവർത്തന സംഗ്രഹം',attendance:'ഹാജറും ജോലി സമയവും',tasks:'ടാസ്ക് പ്രവർത്തനം',clients:'ക്ലയന്റ് ജോലികൾ',kpi:'പ്രകടനത്തിന്റെ രേഖകൾ',leave:'ലീവ് വിവരങ്ങൾ',exits:'ജീവനക്കാരുടെ എക്സിറ്റ് വിവരങ്ങൾ','data-entry':'ഡാറ്റാ എൻട്രി പ്രവർത്തനം' };
function gapText(gap: string): string {
 if (/No approved performance/.test(gap)) return 'ഈ കാലയളവിൽ അംഗീകൃത പ്രകടന സ്കോറുകൾ കണ്ടെത്തിയില്ല.';
 if (/Missing checkout/.test(gap)) return 'ചെക്ക് ഔട്ട് ഇല്ലാത്തതിനാൽ ചിലരുടെ മുഴുവൻ ജോലി സമയം ഉറപ്പിക്കാനാവില്ല.';
 if (/No attendance record is not/.test(gap)) return 'ഹാജർ രേഖ ഇല്ലാത്തതുകൊണ്ട് മാത്രം ഒരാൾ അബ്സന്റ് ആണെന്ന് ഉറപ്പിക്കാനാവില്ല.';
 if (/Attendance hours/.test(gap)) return 'ഈ സമയം ഹാജർ രേഖകളിൽ നിന്നുള്ളതാണ്; തുടർച്ചയായി ടാസ്ക് ചെയ്ത സമയമായി കാണാനാവില്ല.';
 if (/Raw task counts/.test(gap)) return 'ടാസ്കുകളുടെ എണ്ണം മാത്രം നോക്കി വ്യത്യസ്ത വിഭാഗങ്ങളുടെ പ്രകടനം താരതമ്യം ചെയ്യാനാവില്ല.';
 if (/no status history/.test(gap)) return 'ചില ടാസ്കുകൾക്ക് സ്റ്റാറ്റസ് ചരിത്രമില്ല; അവ പൂർത്തിയായ തീയതി ഉറപ്പിക്കാനാവില്ല.';
 if (/No leave allocation/.test(gap)) return 'ലീവ് അലോക്കേഷൻ രേഖ ലഭ്യമല്ല; ബാലൻസ് പൂജ്യമാണെന്ന് പറയാനാവില്ല.';
 if (/Leave allocation balances/.test(gap)) return 'ഇത് നിലവിലെ രേഖപ്പെടുത്തിയ ലീവ് ബാലൻസാണ്; പഴയ തീയതിയിലെ ബാലൻസ് പുനർനിർമിച്ചതല്ല.';
 if (/Approved WFH/.test(gap)) return 'വർക്ക് ഫ്രം ഹോം അനുമതി മാത്രം ജോലി സമയത്തിന്റെ തെളിവല്ല.';
 if (/No authorized employees/.test(gap)) return 'ഈ കാലയളവിൽ നിങ്ങളുടെ അനുമതിയിൽ ഉൾപ്പെടുന്ന ജീവനക്കാരുടെ രേഖകൾ ലഭ്യമല്ല.';
 if (/approved appraisal scores/.test(gap)) return 'ഇവ അംഗീകൃത അപ്രൈസൽ സ്കോറുകളാണ്. ടാസ്ക് എണ്ണത്തെ പുതിയ KPI സ്കോറായി മാറ്റിയിട്ടില്ല.';
 return 'ഈ റിപ്പോർട്ടിന്റെ ചില വിവരങ്ങൾ ലഭ്യമായ രേഖകളിൽ നിന്ന് ഉറപ്പിക്കാനായില്ല.';
}
export function formatMalayalamReport(report: VerifiedReport, verifiedEnglish: string): {markdown:string;spokenReply:string} {
 const {plan}=report;
 const period=plan.start===plan.end?plan.start:`${plan.start} മുതൽ ${plan.end} വരെ`;
 const heading=plan.category==='design'?'ഡിസൈൻ ജോലികൾ':plan.category==='video'?'വീഡിയോ എഡിറ്റിംഗ് ജോലികൾ':titles[plan.kind];
 if (/cannot be verified|ranking is unavailable|ranking cannot|cannot be confirmed|not connected/i.test(verifiedEnglish) && ['most','least'].includes(plan.metric)) return {markdown:'ഈ താരതമ്യം ഉറപ്പിക്കാൻ ആവശ്യമായ പൂർണ്ണവും താരതമ്യയോഗ്യവുമായ രേഖകൾ ലഭ്യമല്ല. ലഭ്യമായ പ്രവർത്തനത്തിന്റെ വിശദാംശങ്ങൾ ചോദിക്കാം.',spokenReply:'ഈ താരതമ്യം ഉറപ്പിക്കാൻ ആവശ്യമായ രേഖകൾ ലഭ്യമല്ല.'};
 const entries=Object.entries(plan.kind==='kpi'?{}:report.totals).filter(([key,value])=>labels[key]&&value>0);
 const rows=report.rows.filter(row=>row.value>0);
 let selected=rows;
 if (['most','least'].includes(plan.metric) && report.rows.length) {
  const value=(plan.metric==='most'?Math.max:Math.min)(...report.rows.map(row=>row.value));selected=report.rows.filter(row=>row.value===value);
 }
 const rowText=(row: typeof rows[number])=>`${row.name} — ${row.value} ${units[row.unit]||row.unit}`;
 let body=entries.map(([key,value])=>`- ${labels[key]}: **${value}**`).join('\n');
 if (plan.groupByDepartment) {
  const grouped=new Map<string,number>();
  for(const row of rows) {const department=report.employees.find(employee=>employee.id===row.employeeId)?.department||'വിഭാഗം രേഖപ്പെടുത്തിയിട്ടില്ല';grouped.set(department,(grouped.get(department)||0)+row.value);}
  body+='\n\n**വിഭാഗങ്ങൾ തിരിച്ചുള്ള രേഖപ്പെടുത്തിയ പ്രവർത്തനം**\n'+[...grouped].map(([department,value])=>`- **${department}** — **${value}** പൂർത്തിയായ ടാസ്കുകൾ`).join('\n')+'\n\nഇത് ടാസ്കുകളുടെ എണ്ണം മാത്രമാണ്. ജോലിയുടെ സങ്കീർണ്ണതയും സമയവും ഉൾപ്പെടുത്തിയ പ്രകടന റാങ്കിംഗ് അല്ല.';
 }
 if (plan.kind!=='overview' && selected.length) body+=(body?'\n\n':'')+`**${plan.metric==='most'?'ഏറ്റവും കൂടുതൽ രേഖപ്പെടുത്തിയവർ':plan.metric==='least'?'ഏറ്റവും കുറവ് രേഖപ്പെടുത്തിയവർ':plan.kind==='clients'?'ക്ലയന്റ് വിവരങ്ങൾ':'ജീവനക്കാരുടെ വിവരങ്ങൾ'}**\n`+selected.slice(0,plan.detailed?50:12).map(row=>`- **${row.name}** — **${row.value}** ${units[row.unit]||row.unit}${plan.detailed&&row.details?`\n  ${row.details}`:''}`).join('\n');
 if (!body) body='ഈ ചോദ്യത്തിന് അനുയോജ്യമായ പ്രവർത്തനം ലഭ്യമായ രേഖകളിൽ കണ്ടെത്തിയില്ല. ഇത് ജോലി ചെയ്തിട്ടില്ല എന്നതിന് തെളിവല്ല.';
 if (plan.kind==='overview') body+='\n\nഹാജർ രേഖ ഇല്ലാത്തതുകൊണ്ട് മാത്രം അബ്സന്റ് ആണെന്ന് പറയാനാവില്ല. പൂർത്തിയായ ടാസ്കുകളുടെ എണ്ണം പ്രകടന സ്കോറല്ല.';
 const important=report.gaps.filter(gap=>plan.detailed||/Missing checkout|No approved|No leave allocation|No authorized/.test(gap));
 if(important.length) body+='\n\n**രേഖകളിലെ പരിമിതികൾ**\n'+[...new Set(important.map(gapText))].map(gap=>`- ${gap}`).join('\n');
 if(report.comparison){const old=report.comparison;const changes=entries.filter(([key])=>old.totals[key]!=null).map(([key,value])=>`- ${labels[key]}: ${old.totals[key]} → ${value}`);body+=`\n\n**${old.plan.start}–${old.plan.end} കാലയളവുമായി താരതമ്യം**\n${changes.join('\n')||'ഒരേ രീതിയിൽ താരതമ്യം ചെയ്യാവുന്ന കണക്കുകൾ ലഭ്യമല്ല.'}`;}
 const speech=plan.kind==='overview'?entries.slice(0,6).map(([key,value])=>`${labels[key]} ${value}`).join('. '):selected.slice(0,3).map(rowText).join('. ')||body.split('\n')[0];
 return {markdown:`### ${heading}\n${period} · ഇന്ത്യൻ സമയം\n\n${body}`,spokenReply:`${speech}. കൂടുതൽ വിശദാംശങ്ങൾ ചാറ്റിൽ കാണാം.`.slice(0,900)};
}
