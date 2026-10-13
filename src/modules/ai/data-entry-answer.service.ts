import { workTrackService } from "../work-track/work-track.service.js";
import { prisma } from "../../lib/prisma.js";
import { db, jobs, sources } from "../job-monitoring/store.js";
import type { UserContext, AIResponsePayload } from "./ai.types.js";
export async function dataEntryAnswer(user: UserContext, question: string, language = "en"): Promise<AIResponsePayload | null> {
 if (!/trikonet|mediyox|ട്രികോനെറ്റ്|മെഡിയോക്സ്|data[\s_-]*entry|mbm|tkt|job sources|portal checks|collected jobs|medbiomate|medbimate|hf\d+|rishana|റിഷാന|രിഷാന|safna|സഫ്ന|hasna|ഹസ്ന|sajna|സജ്ന|sahana|സഹാന|shimna|ഷിംന|shamna|ഷംന|fathima|ഫാത്തിമ|മെഡ്ബയോമേറ്റ്|മെഡ്ബയോമേറ്റ്|ഡാറ്റാ?\s*എൻട്രി|ഡേറ്റാ?\s*എൻട്രി/i.test(question)) return null;
 if (!user.companyId) return null;
 const employee=await prisma.employee.findFirst({where:{userId:user.userId,companyId:user.companyId,status:"ACTIVE"},include:{department:true,designation:true}});
 const allCompanies=user.role === "SUPER_ADMIN";
 const admin=["SUPER_ADMIN","HR_ADMIN","MANAGER"].includes(user.role);
 const dataEntry=/data[\s_-]*entry/i.test(employee?.department?.name||"");
 if (!admin&&!dataEntry) return {intent:"GENERAL_WORKPLACE_QUERY",markdown:"You do not have access to the Data Entry collection.",suggestedFollowUps:[]};
 const company=user.companyId==="cmrtjclxz004eun4zjp7rtcbo"&&dataEntry?"cmrtifqe00002ty4zqy0vdpsr":user.companyId;
 if (/today|ഇന്നത്തെ|ഇന്ന്|count|entry|entries|first|last|work|upload|എൻട്രി|വർക്ക്|ജോലി|ആദ്യ|അവസാന|rishana|റിഷാന|രിഷാന|safna|hasna|sajna|sahana|shimna|സഫ്ന|ഹസ്ന|സജ്ന|സഹാന|ഷിംന/i.test(question) && !/team employees|list employees|ജീവനക്കാരുടെ പട്ടിക/i.test(question)) {
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const sheets=await workTrackService.getDataEntrySheets(user.companyId);
  const visible=admin?await prisma.employee.findMany({where:{...(allCompanies?{}:{companyId:user.companyId}),status:"ACTIVE"},select:{id:true,firstName:true,middleName:true,lastName:true,designation:{select:{title:true}},department:{select:{name:true}}}}):employee?[employee]:[];
  const q=question.toLowerCase();
  const aliases:Record<string,string>={"റിഷാന":"rishana","രിഷാന":"rishana","സഫ്ന":"safna","ഹസ്ന":"hasna","സജ്ന":"sajna","സഹാന":"sahana","ഷിംന":"shimna","ഷംന":"shimna","ഫാത്തിമ":"fathima"};
  const normalizedQuestion=Object.entries(aliases).reduce((v,[from,to])=>v.replaceAll(from,to),q);
  const scoredNames=visible.map(e=>({e,score:[e.firstName,e.middleName,e.lastName].filter(Boolean).reduce((n,v)=>n+(String(v).length>2&&normalizedQuestion.includes(String(v).toLowerCase())?1:0),0)}));
  const bestNameScore=Math.max(0,...scoredNames.map(e=>e.score));
  const targetNames=scoredNames.filter(e=>bestNameScore>0&&e.score===bestNameScore).map(({e})=>[e.firstName,e.middleName,e.lastName].filter(Boolean).join(" ").toLowerCase());
  const platforms=[[/medbiomate|medbimate|mbm|മെഡ്ബ/i,"medbiomate.com"],[/trikonet|tkt|ട്രികോ/i,"trikonet.com"],[/mediyox|മെഡിയോ/i,"mediyox.com"]] as const;
  const selectedPlatforms=platforms.filter(([pattern])=>pattern.test(question)).map(([,host])=>host);
  const platform=selectedPlatforms.length===1?selectedPlatforms[0]:null;
  const names=new Set(visible.map(e=>[e.firstName,e.middleName,e.lastName].filter(Boolean).join(" ").trim().toLowerCase()));
  const unique=new Map<string,any>();
  for(const [key,rows] of Object.entries(sheets)) if(/-(Jobs|Employer)-/.test(key)) for(const r of rows) {
   if(!r.sourceUrl||!r.uploadedAt||(r.activityType!=="edited"&&r.status!=="Uploaded"))continue;
   const rawActor=String(r.activityType==="edited"?r.editedBy||r.uploadedBy:r.uploadedBy||"").trim();
   const alias=rawActor.toLowerCase().replace(/\./g,"");
   const actor=(["rishana","fathima k","fathima rishana","fathima rishana k"].includes(alias)?"Fathima Rishana K":["safna","safna c"].includes(alias)?"Safna C":["hasna","hasna p"].includes(alias)?"Hasna P":["sajna","sajna ps","sajna p s"].includes(alias)?"Sajna PS":rawActor);
   if(!admin&&!names.has(actor.toLowerCase()))continue;
   if(targetNames.length&&!targetNames.includes(actor.toLowerCase()))continue;
   if(/-Employer-/.test(key)&&r.activityType==="edited")continue;
   const at=r.activityType==="edited"?r.editedAt||r.uploadedAt:r.uploadedAt;
   if(!Number.isFinite(Date.parse(at)))continue;
   const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(at));
   if(date!==today)continue;
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
  const timestamps=[...unique.values()].filter(r=>!r.company).map(r=>Date.parse(r.at)).sort((a,b)=>a-b);
  const time=(at:number)=>new Date(at).toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hour12:true});
  const first=timestamps.length?time(timestamps[0]):null,last=timestamps.length?time(timestamps[timestamps.length-1]):null;
  const ml=language==="ml";
  const activeTotals=[...totals].filter(([,n])=>n.created+n.edited+n.companies>0);
  const heading=targetNames.length===1?activeTotals[0]?.[0]||targetNames[0]:ml?"ഡാറ്റാ എൻട്രി ടീം":"Data Entry team";
  const dateLabel=new Date(today+"T12:00:00+05:30").toLocaleDateString(ml?"ml-IN":"en-IN",{day:"numeric",month:"long",year:"numeric"});
  const createdTotal=activeTotals.reduce((n,[,r])=>n+r.created,0),editedTotal=activeTotals.reduce((n,[,r])=>n+r.edited,0);
  const parts=(n:{created:number;edited:number;companies:number})=>[
    n.created?ml?`**${n.created}** പുതിയ ജോബുകൾ പ്രസിദ്ധീകരിച്ചു`:`**${n.created}** jobs published`:"",
    n.edited?ml?`**${n.edited}** ജോബുകൾ അപ്ഡേറ്റ് ചെയ്തു`:`**${n.edited}** jobs updated`:"",
    n.companies?ml?`**${n.companies}** കമ്പനി വിവരങ്ങൾ ചേർത്തു`:`**${n.companies}** company entries added`:""
  ].filter(Boolean).join(" · ");
  let markdown=`### ${heading}\n${dateLabel}\n\n`;
  if(!activeTotals.length) markdown+=ml?"ഈ ദിവസത്തെ പ്രവർത്തനം ലഭ്യമായ രേഖകളിൽ കണ്ടെത്തിയില്ല.":"No activity was found in the available records for this date.";
  else if(activeTotals.length===1) markdown+=parts(activeTotals[0][1])+".\n\n";
  else markdown+=(ml?"**ഇന്നത്തെ സംഗ്രഹം**":"**Today's summary**")+"\n"+parts({created:createdTotal,edited:editedTotal,companies:companyTotal})+".\n\n"+activeTotals.map(([name,n])=>`• **${name}** — ${parts(n)}`).join("\n")+"\n\n";
  const sites=["medbiomate.com","trikonet.com","mediyox.com"].filter(host=>!platform||host===platform);
  const siteNames:Record<string,string>={"medbiomate.com":"Medbiomate","trikonet.com":"Trikonet","mediyox.com":"Mediyox"};
  const siteLines=sites.flatMap(host=>{const rows=[...unique.values()].filter(r=>!r.company&&r.host===host);if(!rows.length)return [];const dates=rows.map(r=>Date.parse(r.at)).sort((a,b)=>a-b);return [`**${siteNames[host]}**${activeTotals.length===1?"":` — ${rows.length} ${ml?"ജോബ് പ്രവർത്തനങ്ങൾ":"job activities"}`}\n${ml?"ആദ്യ എൻട്രി":"First entry"}: **${time(dates[0])}** · ${ml?"അവസാന എൻട്രി":"Last entry"}: **${time(dates[dates.length-1])}** (IST)`];});
  markdown+=siteLines.join("\n\n");
  const summaryNames=[...totals.keys()].filter(name=>{const n=totals.get(name)!;return n.created+n.edited>0;});
  const spokenReply=language==="ml"?`${summaryNames.length===1?summaryNames[0]:"ഡാറ്റാ എൻട്രി ടീം"} ഇന്ന് ${jobTotal} ജോബ് എൻട്രികൾ രേഖപ്പെടുത്തി.${first&&last?` ആദ്യ എൻട്രി ${first}. അവസാന എൻട്രി ${last}.`:""} വിശദാംശങ്ങൾ ചാറ്റിൽ കാണാം.`:`${summaryNames.length===1?summaryNames[0]:"The Data Entry team"} recorded ${jobTotal} job entries today.${first&&last?` First entry ${first}. Last entry ${last}.`:""} The details are in the chat.`;
  return {intent:"GENERAL_WORKPLACE_QUERY",markdown,spokenReply,metrics:{source:"live_data_entry_sheets",date:today,firstEntry:first,lastEntry:last,platform,created:[...totals.values()].reduce((n,r)=>n+r.created,0),edited:[...totals.values()].reduce((n,r)=>n+r.edited,0),retrievedAt:new Date().toISOString()},suggestedFollowUps:[]};
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
