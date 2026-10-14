import type { QueryPlan } from "./verified-query.js";
import { workTrackService } from "../work-track/work-track.service.js";
import { prisma } from "../../lib/prisma.js";
import { db, jobs, sources } from "../job-monitoring/store.js";
import type { UserContext, AIResponsePayload } from "./ai.types.js";
export async function dataEntryAnswer(user: UserContext, question: string, language = "en", plan?: QueryPlan): Promise<AIResponsePayload | null> {
 if (!plan && !/trikonet|mediyox|ട്രികോനെറ്റ്|മെഡിയോക്സ്|data[\s_-]*entry|mbm|tkt|job sources|portal checks|collected jobs|medbiomate|medbimate|hf\d+|rishana|റിഷാന|രിഷാന|safna|സഫ്ന|hasna|ഹസ്ന|sajna|സജ്ന|sahana|സഹാന|shimna|ഷിംന|shamna|ഷംന|fathima|ഫാത്തിമ|മെഡ്ബയോമേറ്റ്|മെഡ്ബയോമേറ്റ്|ഡാറ്റാ?\s*എൻട്രി|ഡേറ്റാ?\s*എൻട്രി/i.test(question)) return null;
 if (!user.companyId) return null;
 const employee=await prisma.employee.findFirst({where:{userId:user.userId,companyId:user.companyId,status:"ACTIVE"},include:{department:true,designation:true}});
 const allCompanies=user.role === "SUPER_ADMIN";
 const admin=["SUPER_ADMIN","HR_ADMIN","MANAGER"].includes(user.role);
 const dataEntry=/data[\s_-]*entry/i.test(employee?.department?.name||"");
 if (!admin&&!dataEntry) return {intent:"GENERAL_WORKPLACE_QUERY",markdown:"You do not have access to the Data Entry collection.",suggestedFollowUps:[]};
 const company=user.companyId==="cmrtjclxz004eun4zjp7rtcbo"&&dataEntry?"cmrtifqe00002ty4zqy0vdpsr":user.companyId;
 if ((plan || /today|ഇന്നത്തെ|ഇന്ന്|count|entry|entries|first|last|work|upload|എൻട്രി|വർക്ക്|ജോലി|ആദ്യ|അവസാന|rishana|റിഷാന|രിഷാന|safna|hasna|sajna|sahana|shimna|സഫ്ന|ഹസ്ന|സജ്ന|സഹാന|ഷിംന/i.test(question)) && !/team employees|list employees|list.*team|ജീവനക്കാരുടെ പട്ടിക/i.test(question)) {
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const start=plan?.start || today, end=plan?.end || today;
  const sheets=await workTrackService.getDataEntrySheets(user.companyId);
  const visible=admin?await prisma.employee.findMany({where:{...(allCompanies?{}:{companyId:user.companyId}),status:"ACTIVE"},select:{id:true,employeeCode:true,firstName:true,middleName:true,lastName:true,designation:{select:{title:true}},department:{select:{name:true}}}}):employee?[employee]:[];
  const q=(plan?.employee && !/^(me|my)$/i.test(plan.employee)?`${question} ${plan.employee}`:question).toLowerCase();
  const aliases:Record<string,string>={"റിഷാന":"rishana","രിഷാന":"rishana","സഫ്ന":"safna","ഹസ്ന":"hasna","സജ്ന":"sajna","സഹാന":"sahana","ഷിംന":"shimna","ഷംന":"shimna","ഫാത്തിമ":"fathima"};
  const normalizedQuestion=Object.entries(aliases).reduce((v,[from,to])=>v.replaceAll(from,to),q);
  const scoredNames=visible.map(e=>({e,score:(e.employeeCode&&normalizedQuestion.includes(e.employeeCode.toLowerCase())?10:0)+[e.firstName,e.middleName,e.lastName].filter(Boolean).reduce((n,v)=>n+(String(v).length>2&&normalizedQuestion.includes(String(v).toLowerCase())?1:0),0)}));
  const bestNameScore=Math.max(0,...scoredNames.map(e=>e.score));
  const targetNames=plan?.employee === "me" && employee ? [[employee.firstName,employee.middleName,employee.lastName].filter(Boolean).join(" ").toLowerCase()] : scoredNames.filter(e=>bestNameScore>0&&e.score===bestNameScore).map(({e})=>[e.firstName,e.middleName,e.lastName].filter(Boolean).join(" ").toLowerCase());
  if(plan?.employee && !/^(me|my)$/i.test(plan.employee) && !targetNames.length) return {intent:'GENERAL_WORKPLACE_QUERY',markdown:language==='ml'?'ഈ പേരിൽ നിങ്ങളുടെ അനുമതിയിൽ ഉൾപ്പെടുന്ന ജീവനക്കാരനെ കണ്ടെത്താനായില്ല. മുഴുവൻ പേരോ employee code-ഓ പറയാമോ?':'No authorized employee matched. Please give the full name or employee code.'};
  if(plan?.employee && targetNames.length>1) return {intent:'GENERAL_WORKPLACE_QUERY',markdown:language==='ml'?'ഈ പേരിൽ ഒന്നിലധികം ജീവനക്കാരുണ്ട്. employee code പറയാമോ?':'Several employees match. Please give the employee code.'};
  const platforms=[[/medbiomate|medbimate|mbm|മെഡ്ബ/i,"medbiomate.com"],[/trikonet|tkt|ട്രികോ/i,"trikonet.com"],[/mediyox|മെഡിയോ/i,"mediyox.com"]] as const;
  const selectedPlatforms=platforms.filter(([pattern])=>pattern.test(question)).map(([,host])=>host);
  const platform=selectedPlatforms.length===1?selectedPlatforms[0]:null;
  if(plan && /source|collect|സോഴ്സ്|ശേഖരി/i.test(question)) {
   const catalog=sources(company), allowedIds=new Set(visible.map(person=>person.id));
   const records=jobs(company).filter(row=>admin ? !row.assignedToId||allowedIds.has(row.assignedToId) : row.assignedToId===employee?.id).filter(row=>!targetNames.length||targetNames.includes((row.assignedToName||'').toLowerCase())).filter(row=>{const at=Date.parse(row.detectedAt);if(!Number.isFinite(at))return false;const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));return day>=start&&day<=end;});
   const counts=new Map<string,number>();for(const row of records)counts.set(row.sourceId,(counts.get(row.sourceId)||0)+1);
   let rows=[...counts].sort((a,b)=>b[1]-a[1]);if(plan.metric==='most'&&rows.length)rows=rows.filter(([,n])=>n===rows[0][1]);
   const lines=rows.slice(0,plan.detailed?40:12).map(([id,n])=>`- **${catalog.find(source=>source.id===id)?.name||'Source ID: '+id}** — **${n}** ${language==='ml'?'ശേഖര രേഖകൾ':'collected records'}`).join('\n');
   const markdown=language==='ml'?`### സ്രോതസ്സുകൾ തിരിച്ചുള്ള ശേഖര വിവരങ്ങൾ\n${start}–${end} · ഇന്ത്യൻ സമയം\n\n${lines||'ഈ കാലയളവിലെ ശേഖര രേഖകൾ കണ്ടെത്തിയില്ല.'}\n\nഇവ ലഭ്യമായ ശേഖര രേഖകളാണ്; പ്രസിദ്ധീകരിച്ച ജോബുകളുടെയോ ജീവനക്കാരുടെ പൂർത്തിയായ ജോലിയുടെയോ എണ്ണമല്ല.`:`Collected records by source, ${start}–${end}:\n\n${lines||'No collection records found.'}\n\nThese are retained collection records, not published-job or employee completion counts.`;
   return {intent:'GENERAL_WORKPLACE_QUERY',markdown,spokenReply:language==='ml'?`ലഭ്യമായ രേഖകളിൽ ${records.length} ശേഖര എൻട്രികൾ കണ്ടെത്തി. സ്രോതസ്സുകൾ തിരിച്ചുള്ള വിവരങ്ങൾ ചാറ്റിൽ കാണാം.`:`Found ${records.length} retained collection records. Source details are in the chat.`,metrics:{source:'live_data_entry_collection',start,end,count:records.length,retrievedAt:new Date().toISOString()}};
  }
  if(plan && ['pending','approval','not-started'].includes(plan.metric)) {
   if(start!==today||end!==today) return {intent:'GENERAL_WORKPLACE_QUERY',markdown:language==='ml'?'പഴയ തീയതിയിലെ പെൻഡിംഗ് സ്റ്റാറ്റസ് പുനർനിർമിക്കാൻ ആവശ്യമായ ചരിത്രം ഈ ഡാറ്റാ എൻട്രി സ്രോതസ്സിൽ ലഭ്യമല്ല. നിലവിലെ പെൻഡിംഗ് ജോലികൾ ചോദിക്കാം.':'Historical pending state is unavailable in this collection. Ask for the current pending jobs.'};
   const allowedIds=new Set(visible.map(person=>person.id));
   const current=jobs(company).filter(row=>!row.unqualifiedAt && (admin ? !row.assignedToId||allowedIds.has(row.assignedToId) : row.assignedToId===employee?.id)).filter(row=>!targetNames.length||targetNames.includes((row.assignedToName||'').toLowerCase())).filter(row=>!platform || (platform==='medbiomate.com'?row.postingWebsite==='Medbiomate':platform==='trikonet.com'?row.postingWebsite==='Trikonet':false));
   const selected=current.filter(row=>plan.metric==='approval'?row.status==='Pending Review':plan.metric==='not-started'?row.status==='Assigned'&&!row.startedAt:['New','Pending Review','Assigned','Verified'].includes(row.status));
   const label=plan.metric==='approval'?'റിവ്യൂ കാത്തിരിക്കുന്ന ജോലികൾ':plan.metric==='not-started'?'തുടങ്ങിയതായി രേഖയില്ലാത്ത അസൈൻ ചെയ്ത ജോലികൾ':'നിലവിലെ പെൻഡിംഗ് ജോലികൾ';
   const markdown=language==='ml'?`### ${label}\n\n${selected.length?`**${selected.length}** ജോലികൾ കണ്ടെത്തി.\n\n`+selected.slice(0,plan.detailed?30:10).map(row=>`- **${row.title}** — ${row.assignedToName||'അസൈൻ ചെയ്തിട്ടില്ല'} · ${row.status}`).join('\n'):'ഈ ഫിൽട്ടറിന് അനുയോജ്യമായ ജോലികൾ നിലവിലെ രേഖകളിൽ കണ്ടെത്തിയില്ല.'}\n\nഇത് ഇപ്പോഴത്തെ സ്റ്റാറ്റസാണ്; ഇന്നത്തെ പൂർത്തിയായ ജോലികളുടെ എണ്ണമല്ല.`:`Current matching jobs: **${selected.length}**.\n\n`+selected.slice(0,10).map(row=>`- ${row.title} — ${row.assignedToName||'Unassigned'} · ${row.status}`).join('\n');
   return {intent:'GENERAL_WORKPLACE_QUERY',markdown,spokenReply:language==='ml'?`${label}: ${selected.length}. വിശദാംശങ്ങൾ ചാറ്റിൽ കാണാം.`:`${selected.length} current matching jobs. Details are in the chat.`,metrics:{source:'live_data_entry_collection',scope:'current_snapshot',count:selected.length,retrievedAt:new Date().toISOString()}};
  }
  const names=new Set(visible.map(e=>[e.firstName,e.middleName,e.lastName].filter(Boolean).join(" ").trim().toLowerCase()));
  const unique=new Map<string,any>();
  for(const [key,rows] of Object.entries(sheets)) if(/-(Jobs|Employer)-/.test(key)) for(const r of rows) {
   if(!r.sourceUrl||!r.uploadedAt||(r.activityType!=="edited"&&r.status!=="Uploaded"))continue;
   const rawActor=String(r.activityType==="edited"?r.editedBy||r.uploadedBy:r.uploadedBy||"").trim();
   const alias=rawActor.toLowerCase().replace(/\./g,"");
   const actor=(["rishana","fathima k","fathima rishana","fathima rishana k"].includes(alias)?"Fathima Rishana K":["safna","safna c"].includes(alias)?"Safna C":["hasna","hasna p"].includes(alias)?"Hasna P":["sajna","sajna ps","sajna p s"].includes(alias)?"Sajna PS":rawActor);
   if(!names.has(actor.toLowerCase()))continue;
   if(targetNames.length&&!targetNames.includes(actor.toLowerCase()))continue;
   if(plan?.updatedOnly&&r.activityType!=="edited")continue;
   if(plan?.publishedOnly&&r.activityType==="edited")continue;
   if(plan?.employerOnly&&!/-Employer-/.test(key))continue;
   if(/-Employer-/.test(key)&&r.activityType==="edited")continue;
   const at=r.activityType==="edited"?r.editedAt||r.uploadedAt:r.uploadedAt;
   if(!Number.isFinite(Date.parse(at)))continue;
   const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(at));
   if(date<start||date>end)continue;
   let url:URL;try{url=new URL(r.sourceUrl);}catch{continue;}if(platform&&url.hostname.replace(/^www\./,"")!==platform)continue;const id=r.postId||url.searchParams.get("p");
   const identity=(/-Employer-/.test(key)?"company:":"job:")+(r.activityType==="edited"?"edited:":"created:")+(id?`${url.hostname}:${id}`:url.href);
   const prior=unique.get(identity);if(!prior||Date.parse(at)>Date.parse(prior.at))unique.set(identity,{actor,at,edited:r.activityType==="edited",company:/-Employer-/.test(key),host:url.hostname.replace(/^www\./,"")});
  }
  const totals=new Map<string,{created:number;edited:number;companies:number}>();
  for(const r of unique.values()){const n=totals.get(r.actor)||{created:0,edited:0,companies:0};r.company?n.companies++:r.edited?n.edited++:n.created++;totals.set(r.actor,n);}
  for(const person of visible){
   if(!/data|entry/i.test(`${person.designation?.title||""} ${person.department?.name||""}`))continue;
   const name=[person.firstName,person.middleName,person.lastName].filter(Boolean).join(" ");
   if(targetNames.length&&!targetNames.includes(name.toLowerCase()))continue;
   if(!totals.has(name))totals.set(name,{created:0,edited:0,companies:0});
  }
  const jobTotal=[...totals.values()].reduce((n,r)=>n+r.created+r.edited,0);const companyTotal=[...totals.values()].reduce((n,r)=>n+r.companies,0);
  let reportRecords=[...unique.values()];
  if(plan && ['most','least'].includes(plan.metric) && totals.size) {
   const count=(n:{created:number;edited:number;companies:number})=>plan.employerOnly?n.companies:n.created+n.edited;
   const best=(plan.metric==='most'?Math.max:Math.min)(...[...totals.values()].map(count));
   const selectedActors=new Set([...totals].filter(([,n])=>count(n)===best).map(([name])=>name));
   reportRecords=reportRecords.filter(row=>selectedActors.has(row.actor));
  }
  const timestamps=reportRecords.filter(r=>!r.company).map(r=>Date.parse(r.at)).sort((a,b)=>a-b);
  const time=(at:number)=>(start!==end?new Date(at).toLocaleDateString("en-IN",{timeZone:"Asia/Kolkata"})+" ":"")+new Date(at).toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hour12:true});
  const first=timestamps.length?time(timestamps[0]):null,last=timestamps.length?time(timestamps[timestamps.length-1]):null;
  const ml=language==="ml";
  let activeTotals=[...totals].filter(([,n])=>n.created+n.edited+n.companies>0);
  if(plan && ['most','least'].includes(plan.metric) && totals.size) {
   const count=(n:{created:number;edited:number;companies:number})=>plan.employerOnly?n.companies:n.created+n.edited;
   const value=(plan.metric==='most'?Math.max:Math.min)(...[...totals.values()].map(count));
   activeTotals=[...totals].filter(([,n])=>count(n)===value);
  }
  const heading=targetNames.length===1?activeTotals[0]?.[0]||targetNames[0]:ml?"ഡാറ്റാ എൻട്രി ടീം":"Data Entry team";
  let dateLabel=new Date(start+"T12:00:00+05:30").toLocaleDateString(ml?"ml-IN":"en-IN",{day:"numeric",month:"long",year:"numeric"});
  if(start!==end) dateLabel=`${start} — ${end}`;
  const createdTotal=activeTotals.reduce((n,[,r])=>n+r.created,0),editedTotal=activeTotals.reduce((n,[,r])=>n+r.edited,0);
  const parts=(n:{created:number;edited:number;companies:number})=>[
    n.created?ml?`**${n.created}** പുതിയ ജോബുകൾ പ്രസിദ്ധീകരിച്ചു`:`**${n.created}** jobs published`:"",
    n.edited?ml?`**${n.edited}** ജോബുകൾ അപ്ഡേറ്റ് ചെയ്തു`:`**${n.edited}** jobs updated`:"",
    n.companies?ml?`**${n.companies}** കമ്പനി വിവരങ്ങൾ ചേർത്തു`:`**${n.companies}** company entries added`:""
  ].filter(Boolean).join(" · ");
  let markdown='';
  if(!activeTotals.length) markdown=ml?`${dateLabel}, ആവശ്യപ്പെട്ട ഡാറ്റാ എൻട്രി പ്രവർത്തനം ലഭ്യമായ രേഖകളിൽ കണ്ടെത്താനായില്ല. ഇത് ജോലി ചെയ്തിട്ടില്ല എന്നതിന് തെളിവല്ല.`:`No matching Data Entry activity was found in the available records for ${dateLabel}. This does not establish that no work was done.`;
  else {
   const plainParts=(n:{created:number;edited:number;companies:number})=>parts(n).replace(/\*\*/g,'').replace(/ · /g,'. ');
   markdown=activeTotals.length===1?`${activeTotals[0][0]} ${dateLabel}, ${plainParts(activeTotals[0][1])}.`:`${dateLabel}, ${ml?'ഡാറ്റാ എൻട്രി ടീമിന്റെ പ്രവർത്തനം പരിശോധിക്കുമ്പോൾ':'the Data Entry records show'} ${plainParts({created:createdTotal,edited:editedTotal,companies:activeTotals.reduce((n,[,r])=>n+r.companies,0)})}.`;
   if(activeTotals.length>1) markdown+='\n\n'+activeTotals.map(([name,n])=>`${name} ${plainParts(n)}.`).join(' ');
   const sites=['medbiomate.com','trikonet.com','mediyox.com'].filter(host=>!platform||host===platform);
   const siteNames:Record<string,string>={'medbiomate.com':'Medbiomate','trikonet.com':'Trikonet','mediyox.com':'Mediyox'};
   const siteLines=sites.flatMap(host=>{const rows=reportRecords.filter(r=>!r.company&&r.host===host);if(!rows.length)return [];const dates=rows.map(r=>Date.parse(r.at)).sort((a,b)=>a-b);return [ml?`${siteNames[host]}-ൽ ആദ്യ എൻട്രി ${time(dates[0])}-നും അവസാന എൻട്രി ${time(dates[dates.length-1])}-നുമാണ് രേഖപ്പെടുത്തിയിരിക്കുന്നത്. ഈ സമയങ്ങൾ എൻട്രികളുടെ സമയമാണ്; ജോലി തുടങ്ങിയതും അവസാനിപ്പിച്ചതുമായ സമയമായി കണക്കാക്കാനാവില്ല.`:`On ${siteNames[host]}, the first entry was recorded at ${time(dates[0])} and the last at ${time(dates[dates.length-1])} IST. These are entry timestamps, not confirmed work start and finish times.`];});
   if(siteLines.length)markdown+='\n\n'+siteLines.join(' ');
  }
  const summaryNames=activeTotals.filter(([,n])=>n.created+n.edited>0).map(([name])=>name);
  const spokenReply=language==="ml"?`${summaryNames.length===1?summaryNames[0]:"ഡാറ്റാ എൻട്രി ടീം"} ${start===today&&end===today?"ഇന്ന്":"തിരഞ്ഞെടുത്ത കാലയളവിൽ"} ${createdTotal+editedTotal} ജോബ് എൻട്രികൾ രേഖപ്പെടുത്തി.${first&&last?` ആദ്യ എൻട്രി ${first}. അവസാന എൻട്രി ${last}.`:""} വിശദാംശങ്ങൾ ചാറ്റിൽ കാണാം.`:`${summaryNames.length===1?summaryNames[0]:"The Data Entry team"} recorded ${createdTotal+editedTotal} job entries for the selected period.${first&&last?` First entry ${first}. Last entry ${last}.`:""} The details are in the chat.`;
  return {intent:"GENERAL_WORKPLACE_QUERY",markdown,spokenReply,metrics:{source:"live_data_entry_sheets",date:start,start,end,firstEntry:first,lastEntry:last,platform,created:[...totals.values()].reduce((n,r)=>n+r.created,0),edited:[...totals.values()].reduce((n,r)=>n+r.edited,0),retrievedAt:new Date().toISOString()},suggestedFollowUps:[]};
 }
 const team = allCompanies ? (await prisma.employee.findMany({include:{designation:true,department:true,company:{select:{name:true}}}})).filter(e=>/data|entry/i.test(`${e.designation?.title||""} ${e.department?.name||""}`)) : admin ? await workTrackService.getDesigners(user.companyId, "data-entry") : employee ? [employee] : [];
 if(/team|employee|staff|hf\d+|rishana|റിഷാന|രിഷാന|safna|സഫ്ന|hasna|ഹസ്ന|sajna|സജ്ന|sahana|സഹാന|shimna|ഷിംന|shamna|ഷംന|fathima|ഫാത്തിമ|ടീം|ജീവനക്കാര|മെഡ്ബ|medbiomate|medbimate/i.test(question)&&!/today|ഇന്നത്തെ|ഇന്ന്/i.test(question)) {
  const selected=team.filter((e:any)=>!(/hf\d+/i.test(question))||question.toLowerCase().includes(e.employeeCode.toLowerCase()));
  const markdown=(language==="ml"?"ഡാറ്റാ എൻട്രി ജീവനക്കാർ":"Data Entry employees")+` (${selected.length})\n\n`+selected.map((e:any)=>`• ${e.employeeCode}: ${[e.firstName,e.middleName,e.lastName].filter(Boolean).join(" ")} — ${e.company?.name||""} — ${e.designation?.title||""} — ${e.status||""}`).join("\n");
  return {intent:"GENERAL_WORKPLACE_QUERY",markdown,spokenReply:markdown,metrics:{source:"live_employee_directory",scope:allCompanies?"all_authorized_companies":"company",retrievedAt:new Date().toISOString()},suggestedFollowUps:[]};
 }
 const records=jobs(company);const websites=sources(company);
 const portalCount=(db().prepare("SELECT count(*) n FROM portal_sources WHERE company=?").get(company) as any).n;
 const statuses=records.reduce((counts:Record<string,number>,r)=>{counts[r.status]=(counts[r.status]||0)+1;return counts;},{});
 const markdown=`Data Entry collection currently contains **${records.length} jobs**, **${websites.length} website sources**, and **${portalCount} portal profiles**.\n\nRecorded job statuses: ${Object.entries(statuses).map(([s,n])=>`${s}: ${n}`).join(", ")}.\n\nData Entry team: ${team.map(e=>[e.firstName,e.middleName,e.lastName].filter(Boolean).join(" ")).join(", ")||"No matching team records"}.\n\nThese are current collection totals, not daily output or KPI scores.`;
 return {intent:"GENERAL_WORKPLACE_QUERY",markdown,spokenReply:markdown.replace(/\*\*/g,""),metrics:{source:"live_data_entry_collection",retrievedAt:new Date().toISOString()},suggestedFollowUps:[]};
}
