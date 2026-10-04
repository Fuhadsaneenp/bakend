const normalize = value => String(value || '').trim().replace(/\s+/g,' ').toLowerCase().replace(/\./g,'');
const alias = value => {const n=normalize(value);return ['hasna','hasna p'].includes(n)?'hasna p':['sajna','sajna ps','sajna p s'].includes(n)?'sajna ps':n;};
export function confirmedJobSheets(sheets, employees) {
  const rows=Object.entries(sheets||{}).filter(([key])=>/-Jobs-/.test(key)).flatMap(([sheet,rows])=>Array.isArray(rows)?rows.map(row=>({...row,sheet})):[]);
  const host=r=>{try{return new URL(r.sourceUrl).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}};
  const post=r=>{try{const id=r.postId||new URL(r.sourceUrl).searchParams.get('p');return id?`${host(r)}:post:${id}`:'';}catch{return '';}};
  const fingerprint=r=>r.jobTitle?.trim()&&r.companyName?.trim()&&r.uploadedBy?.trim()&&r.uploadedAt?JSON.stringify([host(r),normalize(r.jobTitle),normalize(r.companyName),normalize(r.uploadedBy),Date.parse(r.uploadedAt)]):'';
  const identities=new Map(),urls=new Map();
  for(const r of rows){const id=post(r);if(!id)continue;urls.set(r.sourceUrl,id);const fp=fingerprint(r);if(fp){const ids=identities.get(fp)||new Set();ids.add(id);identities.set(fp,ids);}}
  const unique=new Map();const timestamp=r=>Date.parse(r.updatedAt||r.editedAt||r.uploadedAt||'')||0;
  for(const r of rows){if(!host(r))continue;const matches=identities.get(fingerprint(r));const id=post(r)||urls.get(r.sourceUrl)||(matches?.size===1?[...matches][0]:'')||r.sourceUrl;const previous=unique.get(id);if(!previous||timestamp(r)>=timestamp(previous))unique.set(id,{...previous,...r});}
  const output={};
  for(const r of unique.values()){
    if(!r.uploadedAt||r.status!=='Uploaded'||!(r.jobTitle?.trim()||r.companyName?.trim()))continue;
    const operator=alias(r.activityType==='edited'?r.editedBy?.trim()||r.uploadedBy:r.uploadedBy);
    const matches=employees.filter(e=>alias([e.firstName,e.middleName,e.lastName].filter(Boolean).join(' '))===operator||alias(e.displayName)===operator);
    // Personal sheet ownership is not the actor: editors and copied rows must use the displayed operator.
    if(matches.length!==1)continue;
    const at=r.activityType==='edited'?r.editedAt||r.uploadedAt:r.uploadedAt||r.createdAt;
    if(!Number.isFinite(Date.parse(at)))continue;
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
    const key=`${host(r)}-Jobs-${day}-${matches[0].id}`;
    (output[key]||=[]).push({...r,employeeId:matches[0].id,date:day,jobCount:1,activityType:r.activityType==='edited'?'edited':'created'});
  }
  return output;
}
