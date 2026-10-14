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
const joinNames = (names: string[]) => names.length < 2 ? names[0] || '' : names.slice(0,-1).join(', ') + ', ' + names.at(-1);
function dateLabel(day: string): string {
 return new Date(day+'T12:00:00+05:30').toLocaleDateString('ml-IN',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'});
}
export function formatMalayalamReport(report: VerifiedReport, verifiedEnglish: string): {markdown:string;spokenReply:string} {
 const {plan,totals:t}=report;
 const period=plan.start===plan.end?dateLabel(plan.start):`${dateLabel(plan.start)} മുതൽ ${dateLabel(plan.end)} വരെയുള്ള കാലയളവിൽ`;
 if (/cannot be verified|ranking is unavailable|ranking cannot|cannot be confirmed|not connected/i.test(verifiedEnglish) && ['most','least'].includes(plan.metric)) {
  const answer='ഈ താരതമ്യം ഉറപ്പിക്കാൻ ആവശ്യമായ പൂർണ്ണവും താരതമ്യയോഗ്യവുമായ രേഖകൾ ലഭ്യമല്ല. ലഭ്യമായ കണക്കുകൾ മാത്രം ഉപയോഗിച്ച് ഒരാളുടെ പ്രകടനം മികച്ചതാണെന്ന് പറയാനാവില്ല.';
  return {markdown:answer,spokenReply:answer};
 }
 const paragraphs:string[]=[];
 const attendance=plan.kind==='overview'||plan.kind==='attendance';
 if(attendance && ['summary','count'].includes(plan.metric)) {
  const facts:string[]=[];
  if(t.employees>0 && t.checkedIn>0) facts.push(`ഹാജർ വിവരങ്ങൾ പരിശോധിച്ച ${t.employees} പേരിൽ ${t.checkedIn||0} പേർ ചെക്ക് ഇൻ ചെയ്തതായി രേഖയുണ്ട്`);
  if(t.approvedWfh>0) facts.push(`${t.approvedWfh} പേർക്ക് വർക്ക് ഫ്രം ഹോം അനുമതിയുണ്ട്`);
  if(t.approvedLeave>0) facts.push(`${t.approvedLeave} പേർക്ക് ലീവ് അനുവദിച്ചിട്ടുണ്ട്`);
  if(facts.length) paragraphs.push(`${period}, ${facts.join('. ')}.`);
  if(t.lateRecords>0||t.earlyDepartureRecords>0) paragraphs.push([t.lateRecords>0?`വൈകിയെത്തിയതായി ${t.lateRecords} എൻട്രികൾ രേഖപ്പെടുത്തിയിട്ടുണ്ട്`:'',t.earlyDepartureRecords>0?`നേരത്തെ പോയതായി ${t.earlyDepartureRecords} എൻട്രികളുമുണ്ട്`:''].filter(Boolean).join('. ')+'.');
  if(t.noAttendanceRecord>0) paragraphs.push(`${t.noAttendanceRecord} പേരുടെ ഹാജർ രേഖ ഈ കാലയളവിൽ കണ്ടെത്താനായില്ല. അതുകൊണ്ട് മാത്രം അവർ അബ്സന്റ് ആയിരുന്നുവെന്ന് ഉറപ്പിക്കാനാവില്ല.`);
 }
 if(plan.kind==='overview'||plan.kind==='tasks') {
  const facts=[t.completedTasks>0?`${t.completedTasks} ടാസ്കുകൾ പൂർത്തിയാക്കിയതായി രേഖയുണ്ട്`:'',t.approvedTasks>0?`${t.approvedTasks} ടാസ്കുകൾ അപ്രൂവ് ചെയ്തിട്ടുണ്ട്`:'',t.pendingTasks>0?`${t.pendingTasks} ടാസ്കുകൾ ഇനിയും പൂർത്തിയാകാനുണ്ട്`:'',t.awaitingApproval>0?`${t.awaitingApproval} ടാസ്കുകൾ അപ്രൂവൽ കാത്തിരിക്കുന്നു`:'',t.overdueTasks>0?`${t.overdueTasks} ടാസ്കുകളുടെ ഡെഡ്‌ലൈൻ കഴിഞ്ഞിട്ടുണ്ട്`:''].filter(Boolean);
  if(facts.length && (plan.kind==='overview'||['summary','count'].includes(plan.metric))) paragraphs.push(`${plan.kind==='overview'?'ജോലിയുടെ പുരോഗതി നോക്കുമ്പോൾ':period}, ${facts.join('. ')}.`);
 }
 let rows=report.rows.filter(row=>row.value>0);
 if(['most','least'].includes(plan.metric)&&report.rows.length){const value=(plan.metric==='most'?Math.max:Math.min)(...report.rows.map(row=>row.value));rows=report.rows.filter(row=>row.value===value);}
 const rowSentence=(row:typeof report.rows[number])=>{
  if(row.value===0)return `${row.name}യുടെ ഈ പ്രവർത്തനത്തിന് രേഖ കണ്ടെത്തിയില്ല`;
  if(row.unit==='employees checked in')return `${row.name} ചെക്ക് ഇൻ ചെയ്തതായി രേഖയുണ്ട്`;
  if(row.unit==='employees with no attendance record')return `${row.name}യുടെ ഹാജർ രേഖ കണ്ടെത്തിയില്ല`;
  if(row.unit==='employees on approved leave')return `${row.name}ക്ക് ലീവ് അനുവദിച്ചിട്ടുണ്ട്`;
  if(row.unit==='employees with approved WFH')return `${row.name}ക്ക് വർക്ക് ഫ്രം ഹോം അനുമതിയുണ്ട്`;
  if(row.unit==='recorded attendance hours')return `${row.name}യുടെ ഹാജർ രേഖയിൽ ${row.value} മണിക്കൂർ ജോലി സമയം രേഖപ്പെടുത്തിയിട്ടുണ്ട്`;
  if(row.unit==='completed tasks')return `${row.name} ${row.value} ടാസ്കുകൾ പൂർത്തിയാക്കിയതായി രേഖയുണ്ട്`;
  return `${row.name}യുടെ രേഖയിൽ ${row.value} ${units[row.unit]||row.unit} ഉണ്ട്`;
 };
 if(plan.groupByDepartment){
  const grouped=new Map<string,number>();for(const row of rows){const department=report.employees.find(employee=>employee.id===row.employeeId)?.department||'വിഭാഗം രേഖപ്പെടുത്തിയിട്ടില്ല';grouped.set(department,(grouped.get(department)||0)+row.value);}
  if(grouped.size)paragraphs.push([...grouped].map(([department,value])=>`${department} വിഭാഗത്തിൽ ${value} ടാസ്കുകൾ പൂർത്തിയാക്കിയതായി രേഖയുണ്ട്`).join('. ')+'. വ്യത്യസ്ത തരത്തിലുള്ള ജോലികളായതിനാൽ ഈ എണ്ണം മാത്രം നോക്കി പ്രകടനം റാങ്ക് ചെയ്യാനാവില്ല.');
 } else if(plan.kind!=='overview'&&rows.length){
  if(plan.metric==='present') paragraphs.push(`${joinNames(rows.slice(0,plan.detailed?50:12).map(row=>row.name))} ചെക്ക് ഇൻ ചെയ്തതായി രേഖയുണ്ട്.`);
  else if(!(plan.kind==='attendance'&&['summary','count'].includes(plan.metric))) {
   const selected=rows.slice(0,plan.detailed?30:6);
   paragraphs.push(selected.map(row=>rowSentence(row)+'.'+(plan.detailed&&row.details&&!attendance?` രേഖപ്പെടുത്തിയ ജോലികൾ: ${row.details}.`:'')).join(' '));
   if(rows.length>selected.length)paragraphs.push(`ഇതിനു പുറമേ ${rows.length-selected.length} പേരുടെ രേഖകളും ലഭ്യമാണ്. എല്ലാവരുടെയും വിശദാംശങ്ങൾ വേണമെങ്കിൽ ചോദിക്കാം.`);
  }
 }
 if(!paragraphs.length)paragraphs.push(`${period}, ഈ ചോദ്യത്തിന് അനുയോജ്യമായ പ്രവർത്തനം ലഭ്യമായ രേഖകളിൽ കണ്ടെത്താനായില്ല. ഇത് ജോലി ചെയ്തിട്ടില്ല എന്നതിന് തെളിവല്ല.`);
 const important=report.gaps.filter(gap=>/Missing checkout|No approved|No leave allocation|No authorized/.test(gap)||plan.metric==='hours'&&/Attendance hours/.test(gap));
 const gaps=[...new Set(important.map(gapText))];if(gaps.length)paragraphs.push(gaps.join(' '));
 if(report.comparison){const old=report.comparison;const changes=Object.entries(t).filter(([key,value])=>labels[key]&&(value>0||old.totals[key]>0)&&old.totals[key]!=null&&key!=='employees').map(([key,value])=>`${labels[key]} മുൻ കാലയളവിൽ ${old.totals[key]} ആയിരുന്നത് ഇപ്പോൾ ${value} ആണ്`);if(changes.length)paragraphs.push(`${dateLabel(old.plan.start)}–${dateLabel(old.plan.end)} കാലയളവുമായി താരതമ്യം ചെയ്യുമ്പോൾ, ${changes.join('. ')}.`);}
 const markdown=paragraphs.join('\n\n');
 return {markdown,spokenReply:paragraphs.slice(0,2).join(' ').slice(0,1100)};
}
