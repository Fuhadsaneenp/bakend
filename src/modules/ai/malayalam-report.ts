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
const people=(n:number,form:'subject'|'dative'|'possessive'='subject')=>n===1?({subject:'ഒരാൾ',dative:'ഒരാൾക്ക്',possessive:'ഒരാളുടെ'}[form]):`${n} ${{subject:'പേർ',dative:'പേർക്ക്',possessive:'പേരുടെ'}[form]}`;
const taskCount=(n:number,form:'plain'|'emphasis'|'possessive'='plain')=>n===1?({plain:'ഒരു ടാസ്ക്',emphasis:'ഒരു ടാസ്കാണ്',possessive:'ഒരു ടാസ്കിന്റെ'}[form]):`${n} ${{plain:'ടാസ്കുകൾ',emphasis:'ടാസ്കുകളാണ്',possessive:'ടാസ്കുകളുടെ'}[form]}`;
const peopleEmphasis=(n:number)=>n===1?'ഒരാളാണ്':`${n} പേരാണ്`;
const joinNames = (names: string[]) => names.length < 2 ? names[0] || '' : names.slice(0,-1).join(', ') + ', ' + names.at(-1);
function dateLabel(day: string): string {
 return new Date(day+'T12:00:00+05:30').toLocaleDateString('ml-IN',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'});
}
export function formatMalayalamReport(report: VerifiedReport, verifiedEnglish: string): {markdown:string;spokenReply:string} {
 const {plan,totals:t}=report;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 const period=plan.start===plan.end?(plan.start===today?'ഇന്ന് ഇതുവരെ':plan.start===yesterday?'ഇന്നലെ':dateLabel(plan.start)+'-ന്'):`${dateLabel(plan.start)} മുതൽ ${dateLabel(plan.end)} വരെയുള്ള കാലയളവിൽ`;
 if (/cannot be verified|ranking is unavailable|ranking cannot|cannot be confirmed|not connected/i.test(verifiedEnglish) && ['most','least'].includes(plan.metric)) {
  const answer='ഈ താരതമ്യം ഉറപ്പിക്കാൻ ആവശ്യമായ പൂർണ്ണവും താരതമ്യയോഗ്യവുമായ രേഖകൾ ലഭ്യമല്ല. ലഭ്യമായ കണക്കുകൾ മാത്രം ഉപയോഗിച്ച് ഒരാളുടെ പ്രകടനം മികച്ചതാണെന്ന് പറയാനാവില്ല.';
  return {markdown:answer,spokenReply:answer};
 }
 if(plan.kind==='attendance' && plan.metric==='late') {
  const late=report.rows.filter(row=>row.value>0);
  if(!late.length){const answer=`${period} വൈകിയെത്തിയതായി ഹാജർ രേഖകളിൽ കണ്ടെത്തിയില്ല.`;return {markdown:answer,spokenReply:answer};}
  const clock=(value:string)=>new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true});
  const duration=(minutes:number)=>minutes>=60?`${Math.floor(minutes/60)} മണിക്കൂർ${minutes%60?` ${minutes%60} മിനിറ്റ്`:''}`:`${minutes} മിനിറ്റ്`;
  const intro=`${period} ${peopleEmphasis(late.length)} വൈകി ചെക്ക് ഇൻ ചെയ്തത്.`;
  const sentences=late.slice(0,50).map(row=>{
   const events=(row.attendanceEvents||[]).filter(event=>event.isLate);
   if(!events.length)return `${row.name} വൈകിയാണ് വന്നതെന്ന് ഹാജറിൽ കാണുന്നുണ്ട്. പക്ഷേ ചെക്ക് ഇൻ സമയം ലഭ്യമല്ലാത്തതിനാൽ എത്ര മിനിറ്റ് വൈകിയെന്ന് പറയാൻ പറ്റുന്നില്ല.`;
   return events.map(event=>`${row.name} ${plan.start!==plan.end?dateLabel(event.date)+'-ന് ':''}${event.checkInAt?clock(event.checkInAt)+'-നാണ് ചെക്ക് ഇൻ ചെയ്തത്':'ചെക്ക് ഇൻ ചെയ്ത സമയം ലഭ്യമല്ല'}. ${clock(event.scheduledStart)}-ന് തുടങ്ങേണ്ട ഷിഫ്റ്റായതിനാൽ${event.lateMinutes!=null&&event.lateMinutes>0?` ${duration(event.lateMinutes)} വൈകിയാണ് ചെക്ക് ഇൻ ചെയ്തിരിക്കുന്നത്.`:' എത്ര സമയം വൈകിയെന്ന് ലഭ്യമായ വിവരങ്ങളിൽ നിന്ന് ഉറപ്പിക്കാൻ പറ്റുന്നില്ല.'}`).join(' ');
  });
  const note='ഷിഫ്റ്റ് തുടങ്ങേണ്ട സമയവുമായി താരതമ്യം ചെയ്താണ് വൈകിയ സമയം കണക്കാക്കിയത്. പ്രത്യേക ഷിഫ്റ്റ് നൽകിയിട്ടില്ലാത്തവർക്ക് സ്ഥാപനത്തിന്റെ സാധാരണ ജോലി സമയമാണ് എടുത്തത്.'+(plan.start!==new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())?' പഴയ ഷിഫ്റ്റ് മാറ്റങ്ങളുടെ ചരിത്രം ലഭ്യമല്ലാത്തതിനാൽ നിലവിലുള്ള ഷിഫ്റ്റ് ക്രമീകരണമാണ് അടിസ്ഥാനമാക്കിയത്.':'');
  const voice=[intro];
  const shortSentences=late.flatMap(row=>(row.attendanceEvents||[]).filter(event=>event.isLate).map(event=>`${row.name} ${event.checkInAt?clock(event.checkInAt)+'-ന് ചെക്ക് ഇൻ ചെയ്തു':'വൈകിയതായി രേഖയുണ്ട്'}${event.lateMinutes!=null&&event.lateMinutes>0?`, ഷിഫ്റ്റ് തുടങ്ങേണ്ട സമയത്തേക്കാൾ ${duration(event.lateMinutes)} വൈകി`:''}.`));
  let read=0;for(const sentence of shortSentences){if(voice.join(' ').length+sentence.length>1050)break;voice.push(sentence);read++;}
  if(read<shortSentences.length)voice.push('ബാക്കിയുള്ളവരുടെ കൃത്യമായ സമയങ്ങൾ ചാറ്റിൽ കാണാം.');
  return {markdown:[intro,...sentences,note].join('\n\n'),spokenReply:voice.join(' ')};
 }
 if(plan.kind==='attendance'&&plan.metric==='early-arrival'){
  const rows=report.rows.filter(row=>row.value>0);
  const clock=(value:string)=>new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true});
  const intro=rows.length?`ഹാജർ രേഖപ്രകാരം ${period} ${peopleEmphasis(rows.length)} ഷിഫ്റ്റ് തുടങ്ങുന്നതിന് മുമ്പേ ചെക്ക് ഇൻ ചെയ്തത്.`:`${period} ഷിഫ്റ്റ് തുടങ്ങുന്നതിന് മുമ്പ് ചെക്ക് ഇൻ ചെയ്തതായി ലഭ്യമായ രേഖകളിൽ കണ്ടെത്തിയില്ല.`;
  const descriptions=rows.slice(0,50).flatMap(row=>(row.attendanceEvents||[]).filter(event=>event.checkInAt&&Date.parse(event.checkInAt)<Date.parse(event.scheduledStart)).map(event=>`${row.name} ${plan.start!==plan.end?dateLabel(event.date)+'-ന് ':''}${clock(event.checkInAt!)}-ന് ചെക്ക് ഇൻ ചെയ്തു. ഷിഫ്റ്റ് ${clock(event.scheduledStart)}-ന് തുടങ്ങേണ്ടതിനാൽ ${event.earlyArrivalMinutes?`${event.earlyArrivalMinutes} മിനിറ്റ്`:'ഒരു മിനിറ്റിൽ താഴെ'} നേരത്തെയാണ് ചെക്ക് ഇൻ ചെയ്തിരിക്കുന്നത്.`));
  const caution=rows.length?' ഈ കണക്ക് ലഭ്യമായ ഷിഫ്റ്റ് സമയത്തെ അടിസ്ഥാനമാക്കിയുള്ളതാണ്; പഴയ ഷിഫ്റ്റ് മാറ്റങ്ങളുടെ ചരിത്രം ലഭ്യമല്ല.':'';
  const markdown=[intro,...descriptions].join('\n\n')+caution;
  const spoken=[intro];for(const sentence of descriptions){if(spoken.join(' ').length+sentence.length>1050)break;spoken.push(sentence);}
  if(spoken.length-1<descriptions.length)spoken.push('ബാക്കിയുള്ളവരുടെ സമയങ്ങൾ ചാറ്റിൽ കാണാം.');
  return {markdown,spokenReply:spoken.join(' ')};
 }
 const paragraphs:string[]=[];
 const attendance=plan.kind==='overview'||plan.kind==='attendance';
 if(attendance && ['summary','count','present'].includes(plan.metric)) {
  const facts:string[]=[];
  if(t.checkedIn>0) facts.push(`${peopleEmphasis(t.checkedIn)} ഹാജർ രേഖപ്പെടുത്തിയിരിക്കുന്നത്`);
  if(t.wfhCheckedIn>0) facts.push(`അതിൽ ${people(t.wfhCheckedIn,'dative')} വീട്ടിൽനിന്ന് ജോലി ചെയ്യാൻ അനുമതിയുണ്ട്`);
  const otherWfh=(t.approvedWfh||0)-(t.wfhCheckedIn||0);
  if(otherWfh>0) facts.push(`ഇതിനു പുറമെ ${people(otherWfh,'dative')} വീട്ടിൽനിന്ന് ജോലി ചെയ്യാൻ അനുമതിയുണ്ട്; അവരുടെ ചെക്ക് ഇൻ വിവരം ലഭിച്ചിട്ടില്ല`);
  if(t.approvedLeave>0) facts.push(`${people(t.approvedLeave,'dative')} അവധി അനുവദിച്ചിട്ടുണ്ട്`);
  if(facts.length)paragraphs.push(`${period} ${facts.join('. ')}.`);
  if(t.noAttendanceRecord>0)paragraphs.push(`${people(t.noAttendanceRecord,'possessive')} ഹാജർ വിവരം കിട്ടിയിട്ടില്ല. അവർ അവധിയിലായിരുന്നോ എന്ന് ഇതു മാത്രം നോക്കി ഉറപ്പിക്കാൻ പറ്റില്ല.`);
  if(plan.metric!=='present'&&(t.lateRecords>0||t.earlyDepartureRecords>0))paragraphs.push([t.lateRecords>0?`വൈകിയെത്തിയതായി ${t.lateRecords} ഹാജർ എൻട്രികളുണ്ട്`:'',t.earlyDepartureRecords>0?`${t.earlyDepartureRecords} എൻട്രികളിൽ ജോലി സമയം കഴിയുന്നതിന് മുമ്പ് ചെക്ക് ഔട്ട് ചെയ്തതായി കാണുന്നുണ്ട്`:''].filter(Boolean).join('. ')+'.');
 }
 if(plan.kind==='overview'||plan.kind==='tasks') {
  const facts=[t.completedTasks>0?`${taskCount(t.completedTasks)} പൂർത്തിയായിട്ടുണ്ട്`:'',t.approvedTasks>0?`${taskCount(t.approvedTasks)} അപ്രൂവ് ചെയ്തിട്ടുണ്ട്`:'',t.pendingTasks>0?`${taskCount(t.pendingTasks)} ഇനിയും ബാക്കിയാണ്`:'',t.awaitingApproval>0?`${taskCount(t.awaitingApproval)} അപ്രൂവൽ കാത്തിരിക്കുന്നു`:'',t.overdueTasks>0?`${t.pendingTasks>0?'ബാക്കിയുള്ളവയിൽ ':''}${taskCount(t.overdueTasks,'possessive')} ഡെഡ്‌ലൈൻ കഴിഞ്ഞിട്ടുണ്ട്`:''].filter(Boolean);
  if(facts.length&&(plan.kind==='overview'||['summary','count'].includes(plan.metric)))paragraphs.push(`${plan.kind==='overview'?'ജോലിയുടെ കാര്യത്തിൽ,':period} ${facts.join('. ')}.`);
 }
 const clockQuestion=plan.kind==='attendance'&&/check.?in time|check.?out time|when.*(?:start|arriv)|എപ്പോൾ|എത്ര മണി|തുടങ്ങിയ സമയം/i.test(plan.currentQuestion);
 let rows=report.rows.filter(row=>row.value>0 || plan.kind==='attendance' && (plan.metric==='hours'||clockQuestion) && row.attendanceEvents?.some(event=>event.checkInAt));
 if(['most','least'].includes(plan.metric)&&report.rows.length){const value=(plan.metric==='most'?Math.max:Math.min)(...report.rows.map(row=>row.value));rows=report.rows.filter(row=>row.value===value);}
 const rowSentence=(row:typeof report.rows[number])=>{
  if(row.value===0&&row.attendanceEvents?.some(event=>event.checkInAt&&!event.checkOutAt))return `${row.name} ചെക്ക് ഇൻ ചെയ്തിട്ടുണ്ട്. പക്ഷേ ചെക്ക് ഔട്ട് സമയം ഇല്ലാത്തതിനാൽ ആകെ എത്രനേരം ജോലി ചെയ്തെന്ന് പറയാൻ പറ്റുന്നില്ല`;
  if(row.value===0)return `${row.name}-ന്റെ ഈ പ്രവർത്തനത്തെക്കുറിച്ചുള്ള വിവരം ഇപ്പോൾ ലഭ്യമല്ല`;
  if(row.unit==='employees checked in')return `${row.name} ചെക്ക് ഇൻ ചെയ്തിട്ടുണ്ട്`;
  if(row.unit==='employees with no attendance record')return `${row.name}-ന്റെ ഹാജർ വിവരം കിട്ടിയിട്ടില്ല`;
  if(row.unit==='employees on approved leave')return `${row.name}-ന് അവധി അനുവദിച്ചിട്ടുണ്ട്`;
  if(row.unit==='employees with approved WFH')return `${row.name}-ന് വീട്ടിൽനിന്ന് ജോലി ചെയ്യാൻ അനുമതിയുണ്ട്`;
  if(row.unit==='recorded attendance hours'){const minutes=(row.attendanceEvents||[]).filter(event=>event.checkInAt&&event.checkOutAt).reduce((sum,event)=>sum+Math.max(0,event.workMinutes),0);const duration=minutes?`${Math.floor(minutes/60)?Math.floor(minutes/60)+' മണിക്കൂർ ':''}${minutes%60?minutes%60+' മിനിറ്റ്':''}`.trim():`${row.value} മണിക്കൂർ`;return `ഹാജർ കണക്കനുസരിച്ച് ${row.name} ${duration} ജോലി ചെയ്തിട്ടുണ്ട്`;}
  if(row.unit==='average recorded hours per complete attendance record')return `${row.name}-ന്റെ പൂർണ്ണമായ ഹാജർ എൻട്രികൾ നോക്കുമ്പോൾ ശരാശരി ${row.value} മണിക്കൂർ വീതമാണുള്ളത്`;
  if(row.unit==='leave request'){const dates=row.details?.match(/\d{4}-\d{2}-\d{2}/g)||[];const status=row.details?.split(':')[0];const state=status==='APPROVED'?'അപേക്ഷ അനുവദിച്ചിട്ടുണ്ട്':status==='REJECTED'?'അപേക്ഷ നിരസിച്ചിട്ടുണ്ട്':'അപേക്ഷയിൽ തീരുമാനമായിട്ടില്ല';return dates.length?`${row.name}-ന് ${dateLabel(dates[0]!)}${dates[1]&&dates[1]!==dates[0]?' മുതൽ '+dateLabel(dates[1]!)+' വരെ':'-ലെ'} അവധിക്കുള്ള അപേക്ഷയുണ്ട്. ${state}`:`${row.name}-ന്റെ അവധിക്കുള്ള അപേക്ഷ ലഭ്യമാണ്. ${state}`;}
  if(row.unit==='pending tasks')return `${row.name} പൂർത്തിയാക്കേണ്ട ${taskCount(row.value)} ഇനിയും ബാക്കിയാണ്`;
  if(row.unit==='overdue tasks')return `${row.name}-ന്റെ ${taskCount(row.value,"possessive")} ഡെഡ്‌ലൈൻ കഴിഞ്ഞിട്ടുണ്ട്`;
  if(row.unit==='tasks awaiting approval')return `${row.name}-ന്റെ ${taskCount(row.value)} അപ്രൂവൽ കാത്തിരിക്കുന്നു`;
  if(row.unit==='tasks not started')return `${row.name}-ന് നൽകിയ ${taskCount(row.value)} തുടങ്ങിയതായി ഇതുവരെ വിവരമില്ല`;
  if(row.unit==='pending client deliverables')return `${row.name} ക്ലയന്റിന്റെ ${row.value} ജോലികൾ പൂർത്തിയാകാനുണ്ട്`;
  if(row.unit==='overdue client deliverables')return `${row.name} ക്ലയന്റിന്റെ ${row.value} ജോലികളുടെ ഡെഡ്‌ലൈൻ കഴിഞ്ഞിട്ടുണ്ട്`;
  if(row.unit==='client deliverables awaiting approval')return `${row.name} ക്ലയന്റിന്റെ ${row.value} ജോലികൾ അപ്രൂവൽ കാത്തിരിക്കുന്നു`;
  if(row.unit==='completed client deliverables')return `${row.name} ക്ലയന്റിന് വേണ്ടിയുള്ള ${row.value} ജോലികൾ പൂർത്തിയായതായി രേഖയുണ്ട്`;
  if(row.unit==='approved appraisal score')return `${row.name}-ന്റെ അംഗീകൃത അപ്രൈസൽ സ്കോർ ${row.value} ആണ്`;
  if(row.unit.endsWith(' remaining days'))return `${row.name}-ന് ${row.unit.replace(' remaining days','')} ഇനത്തിൽ ${row.value} ദിവസത്തെ അവധി ബാക്കിയുണ്ട്`;
  if(row.unit==='missing checkout records')return `${row.name}-ന്റെ ${row.value} ഹാജർ എൻട്രികളിൽ ചെക്ക് ഔട്ട് സമയം ഇല്ല`;
  if(row.unit==='early departure records')return `${row.name} ${row.value} ദിവസം ജോലി സമയം കഴിയുന്നതിന് മുമ്പ് ചെക്ക് ഔട്ട് ചെയ്തിട്ടുണ്ട്`;
  if(row.unit==='completed tasks')return `${row.name} ${taskCount(row.value)} പൂർത്തിയാക്കിയിട്ടുണ്ട്`;
  return `${row.name}-നെക്കുറിച്ചുള്ള കണക്കിൽ ${row.value} ${units[row.unit]||row.unit} ആണ് കാണുന്നത്`;
 };
 if(plan.groupByDepartment){
  const grouped=new Map<string,number>();for(const row of rows){const department=report.employees.find(employee=>employee.id===row.employeeId)?.department||'വിഭാഗം രേഖപ്പെടുത്തിയിട്ടില്ല';grouped.set(department,(grouped.get(department)||0)+row.value);}
  if(grouped.size)paragraphs.push([...grouped].map(([department,value])=>`${department} വിഭാഗത്തിൽ ${value} ടാസ്കുകൾ പൂർത്തിയാക്കിയതായി രേഖയുണ്ട്`).join('. ')+'. വ്യത്യസ്ത തരത്തിലുള്ള ജോലികളായതിനാൽ ഈ എണ്ണം മാത്രം നോക്കി പ്രകടനം റാങ്ക് ചെയ്യാനാവില്ല.');
 } else if(plan.kind!=='overview'&&rows.length){
  if(plan.metric==='present') {
   const names=report.attendanceGroups?.checkedIn || rows.map(row=>row.name);
   if(names.length)paragraphs.push(`ഹാജർ രേഖപ്പെടുത്തിയിരിക്കുന്നത് ${joinNames(names.slice(0,50))} ${names.length===1?'ആണ്':'എന്നിവരാണ്'}.${names.length>50?` ശേഷിക്കുന്ന ${names.length-50} പേരുടെ വിവരങ്ങളും ലഭ്യമാണ്.`:''}`);
   const wfh=report.attendanceGroups?.approvedWfh||[];
   if(wfh.length)paragraphs.push(`വീട്ടിൽനിന്ന് ജോലി ചെയ്യാൻ അനുമതിയുള്ളത് ${joinNames(wfh)} ${wfh.length===1?'എന്നയാൾക്കാണ്':'എന്നിവർക്കാണ്'}.`);
   if(/office|ഓഫീസ/i.test(plan.currentQuestion))paragraphs.push('ഹാജർ രേഖകൾ മാത്രം നോക്കി ഇവരെല്ലാം ഓഫീസിൽ നേരിട്ട് വന്നതാണെന്ന് ഉറപ്പിക്കാനാവില്ല.');
  }
  else if(clockQuestion || !(plan.kind==='attendance'&&['summary','count'].includes(plan.metric))) {
   const selected=rows.slice(0,plan.detailed?30:6);
   paragraphs.push(selected.map(row=>{
    let answer=rowSentence(row)+'.';
    if(row.workItems?.length && (plan.detailed || ["pending","overdue","approval","not-started"].includes(plan.metric))){const items=row.workItems.slice(0,plan.detailed?10:3);answer+=' '+items.map(item=>`“${item.title}” പൂർത്തിയാക്കേണ്ടത് ${new Date(item.deadline).toLocaleString('ml-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}-നാണ്.`).join(' ');if(row.workItems.length>items.length)answer+=` മറ്റു ${row.workItems.length-items.length} ജോലികളുടെ വിവരങ്ങളും ലഭ്യമാണ്.`;}
    else if(plan.detailed&&row.details&&!attendance)answer+=` രേഖയിൽ ലഭ്യമായ വിശദാംശങ്ങൾ: ${row.details}.`;
    if(attendance && row.attendanceEvents?.length && (plan.metric==='hours'||/check.?in|check.?out|എത്ര മണി|എപ്പോൾ|തുടങ്ങിയ സമയം/.test(plan.currentQuestion))){
     const clock=(value:string)=>new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true});
     answer+=' '+row.attendanceEvents.slice(0,plan.detailed?10:2).map(event=>`${plan.start!==plan.end?dateLabel(event.date)+'-ന് ':''}${event.checkInAt?clock(event.checkInAt)+'-നാണ് ചെക്ക് ഇൻ ചെയ്തത്':'ചെക്ക് ഇൻ സമയം ലഭ്യമല്ല'}.${event.checkOutAt?` ചെക്ക് ഔട്ട് ചെയ്തത് ${clock(event.checkOutAt)}-നാണ്.`:' ചെക്ക് ഔട്ട് സമയം ഇല്ലാത്തതിനാൽ ആകെ എത്രനേരം ജോലി ചെയ്തെന്ന് ഉറപ്പിക്കാൻ പറ്റില്ല.'}`).join(' ');
    }
    return answer;
   }).join(' '));
   if(rows.length>selected.length)paragraphs.push(`ഇതിനു പുറമേ ${people(rows.length-selected.length,"possessive")} രേഖകളും ലഭ്യമാണ്. എല്ലാവരുടെയും വിശദാംശങ്ങൾ വേണമെങ്കിൽ ചോദിക്കാം.`);
  }
 }
 if(!paragraphs.length)paragraphs.push(`${period} നിങ്ങൾ ചോദിച്ച പ്രവർത്തനത്തെക്കുറിച്ചുള്ള വിവരം ഇപ്പോൾ ലഭ്യമല്ല. അതുകൊണ്ട് ജോലി ചെയ്തിട്ടില്ലെന്ന് പറയാനാവില്ല.`);
 const important=report.gaps.filter(gap=>/Missing checkout|No approved|No leave allocation|No authorized/.test(gap)||plan.metric==='hours'&&/Attendance hours/.test(gap));
 const gaps=[...new Set(important.map(gapText))];if(gaps.length)paragraphs.push(gaps.join(' '));
 if(report.comparison){const old=report.comparison;const changes=Object.entries(t).filter(([key,value])=>labels[key]&&(value>0||old.totals[key]>0)&&old.totals[key]!=null&&key!=='employees').map(([key,value])=>`${labels[key]} മുൻ കാലയളവിൽ ${old.totals[key]} ആയിരുന്നത് ഇപ്പോൾ ${value} ആണ്`);if(changes.length)paragraphs.push(`${dateLabel(old.plan.start)}–${dateLabel(old.plan.end)} കാലയളവുമായി താരതമ്യം ചെയ്യുമ്പോൾ, ${changes.join('. ')}.`);}
 const markdown=paragraphs.join('\n\n');
 const spoken:string[]=[];
 const speechText=(plan.metric==='present'?paragraphs:paragraphs.slice(0,2)).join(' ');
 for(const sentence of speechText.split(/(?<=[.!?])\s+/)) {if(spoken.join(' ').length+sentence.length>1100)break;spoken.push(sentence);}
 return {markdown,spokenReply:spoken.join(' ')||'വിശദമായ വിവരങ്ങൾ ചാറ്റിൽ കാണാം.'};
}
