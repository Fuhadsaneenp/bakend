import type {NameRecord} from './employee-name.service.js';
import {jobs} from '../job-monitoring/store.js';
import {jobPostingWebsite,jobVisibleInCollection} from '../job-monitoring/types.js';

type TrackedTask={title:string;employer:string;actor:string;platform:string;status:string;startedAt?:string|null;at?:string|null;url?:string};
const fullName=(person:NameRecord)=>[person.firstName,person.middleName,person.lastName].filter(Boolean).join(' ');
export function currentDataEntryTasks(company:string,sheets:Record<string,any[]>,visible:(NameRecord&{userId?:string|null})[],targetNames:string[],platform:string|null,includeUnassigned:boolean):TrackedTask[]{
 const names=new Map(visible.map(person=>[fullName(person).toLowerCase(),person]));
 const allowed=new Set(visible.map(person=>person.id));
 const host=(value:string)=>{try{return new URL(value).hostname.replace(/^www\./,'');}catch{return '';}};
 const site=(value:string)=>/medbiomate|medbimate|മെഡ്ബ|mbm/i.test(value)?'medbiomate.com':/trikonet|ട്രികോ|tkt/i.test(value)?'trikonet.com':/mediyox|മെഡിയോ/i.test(value)?'mediyox.com':'';
 const records=new Map<string,TrackedTask>();
 const uploaded=new Set<string>();
 for(const [key,rows] of Object.entries(sheets)){
  const parts=key.match(/^(.+?)-(Jobs|Employer|SMM)-(\d{4}-\d{2}-\d{2})-(.+)$/);
  if(!parts)continue;
  const owner=visible.find(person=>[person.id,person.employeeCode,person.userId].includes(parts[4]));
  for(const row of rows){
   if(!/^(uploaded|published|approved|completed|updated)$/i.test(String(row.status||''))||!row.sourceUrl)continue;
   const person=owner||names.get(String(row.employeeName||row.uploadedBy||'').trim().toLowerCase());
   if(person)uploaded.add(fullName(person)+'|'+row.sourceUrl);
  }
 }

 for(const row of jobs(company)){
  if(!jobVisibleInCollection(row)||row.unqualifiedAt||!['New','Assigned','Pending Review','Verified'].includes(row.status))continue;
  if(row.assignedToId?!allowed.has(row.assignedToId):!includeUnassigned)continue;
  const person=visible.find(person=>person.id===row.assignedToId);
  const actor=person?fullName(person):'';
  if(targetNames.length&&!targetNames.includes(actor.toLowerCase()))continue;
  const website=site(jobPostingWebsite(row))||host(row.originalUrl);
  if(platform&&website!==platform)continue;
  const value={title:row.title,employer:row.employer,actor,platform:website,status:row.status,startedAt:row.startedAt,at:row.assignedAt,url:row.originalUrl};
  records.set(`${website}|${actor}|${row.originalUrl||row.employer+'|'+row.title}`,value);
 }
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 for(const [key,rows] of Object.entries(sheets)){
  const parts=key.match(/^(.+?)-(Jobs|Employer|SMM)-(\d{4}-\d{2}-\d{2})-(.+)$/);
  if(!parts||parts[3]>today)continue;
  const owner=visible.find(person=>[person.id,person.employeeCode,person.userId].includes(parts[4]));
  for(const row of rows){
   if(!['not uploaded','pending','draft','assigned','in progress','in_progress','editing','pending review','verified'].includes(String(row.status||'').toLowerCase()))continue;
   const person=owner||names.get(String(row.employeeName||'').trim().toLowerCase());
   if(!person)continue;
   const actor=fullName(person);if(targetNames.length&&!targetNames.includes(actor.toLowerCase()))continue;
   const title=String(row.jobTitle||row.title||'').trim(),employer=String(row.companyName||'').trim();
   if(!title&&!employer)continue;
   const website=site(parts[1])||site(String(row.platformName||row.platform||''))||site(host(String(row.sourceUrl||'')))||host(String(row.sourceUrl||''));
   if(platform&&website!==platform)continue;
   const value={title,employer,actor,platform:website,status:String(row.status),startedAt:typeof row.startedAt==='string'?row.startedAt:null,at:typeof row.assignedAt==='string'?row.assignedAt:null,url:typeof row.sourceUrl==='string'?row.sourceUrl:undefined};
   const identity=`${website}|${actor}|${value.url||employer+'|'+title}`;
   if(!records.has(identity))records.set(identity,value);
  }
 }
 return [...records.values()].filter(row=>!row.url||!uploaded.has(row.actor+'|'+row.url)).sort((a,b)=>Number(Boolean(b.startedAt))-Number(Boolean(a.startedAt)) || (Date.parse(b.at||'')||0)-(Date.parse(a.at||'')||0));
}
export function describeDataEntryTasks(tasks:TrackedTask[],language:string,detailed:boolean):string{
 if(!tasks.length)return language==='ml'?'ഡാറ്റാ എൻട്രി ട്രാക്കിൽ നിലവിൽ ബാക്കിയുള്ള അസൈൻമെന്റുകളൊന്നും കണ്ടെത്തിയില്ല. പ്രസിദ്ധീകരിച്ച എൻട്രികളുടെ കണക്ക് വേറെയാണ്.':'No current matching assignments were found in the Data Entry track. Published activity is reported separately.';
 const labels:Record<string,string>={'New':'പുതിയതായി ശേഖരിച്ചത്','Assigned':'അസൈൻ ചെയ്തിട്ടുണ്ട്','Pending Review':'റിവ്യൂ കാത്തിരിക്കുന്നു','Verified':'വെരിഫൈ ചെയ്തിട്ടുണ്ട്','Not Uploaded':'അപ്‌ലോഡ് ചെയ്തിട്ടില്ല','Pending':'ബാക്കിയുണ്ട്','Draft':'ഡ്രാഫ്റ്റിലാണ്','In Progress':'ചെയ്തുകൊണ്ടിരിക്കുന്നു','IN_PROGRESS':'ചെയ്തുകൊണ്ടിരിക്കുന്നു','Editing':'എഡിറ്റ് ചെയ്യുന്നു'};
 const clock=(at:string)=>new Date(at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:true});
 const selected=tasks.slice(0,detailed?15:5);
 return (language==='ml'?`ഡാറ്റാ എൻട്രി ട്രാക്കിൽ ഇപ്പോൾ ${tasks.length} അസൈൻമെന്റുകളാണ് ഈ വിഭാഗത്തിൽ ഉള്ളത്. `:`The Data Entry track currently contains ${tasks.length} matching assignments. `)+selected.map(task=>language==='ml'?`${task.actor||'ജീവനക്കാരനെ അസൈൻ ചെയ്തിട്ടില്ലാത്ത'} ${task.platform?task.platform+'-ലെ ':''}${task.employer?'“'+task.employer+'” എന്ന കമ്പനിയുടെ ':''}${task.title?'“'+task.title+'” എന്ന ജോബ്':'കമ്പനി എൻട്രി'} — ${labels[task.status]||task.status}.${task.startedAt&&Number.isFinite(Date.parse(task.startedAt))?' തുടങ്ങിയതായി രേഖപ്പെടുത്തിയ സമയം '+clock(task.startedAt)+' IST ആണ്.':''}`:`${task.actor||'Unassigned'}: ${task.platform?task.platform+' — ':''}${task.employer?'“'+task.employer+'” — ':''}${task.title?'“'+task.title+'”':'company entry'}; status ${task.status}.${task.startedAt&&Number.isFinite(Date.parse(task.startedAt))?' Recorded start '+clock(task.startedAt)+' IST.':''}`).join(' ')+(tasks.length>selected.length?(language==='ml'?` ശേഷിക്കുന്ന ${tasks.length-selected.length} അസൈൻമെന്റുകളും ഈ കണക്കിൽ ഉൾപ്പെടുന്നു.`:` The remaining ${tasks.length-selected.length} assignments are included in the total.`):'');
}
