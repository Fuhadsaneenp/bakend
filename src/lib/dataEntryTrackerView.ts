const trackerViews = new WeakMap<object, Record<string, any[]>>();
/** Read-only Post Tracker projection: mirror its URL identity and publication cutoff. */
export function dataEntryTrackerView(sheets:Record<string,any[]>):Record<string,any[]> {
 const cached = trackerViews.get(sheets); if (cached) return cached;
 const cutoff=Date.parse('2026-10-01T18:30:00Z'), best=new Map<string,{key:string;row:any;time:number}>();
 for(const [key,rows] of Object.entries(sheets)){
  const portal=key.match(/^(.+?)-Jobs-\d{4}-\d{2}-\d{2}(?:-|$)/)?.[1];if(!portal)continue;
  for(const row of rows){const url=String(row.sourceUrl||'').trim(),time=Date.parse(row.uploadedAt||'');
   if(row.status!=='Uploaded'||row.activityType==='edited'||!url||!Number.isFinite(time)||time<cutoff)continue;
   let count=0;
   if(row.jobCount!==undefined&&row.jobCount!==null&&String(row.jobCount).trim()!=='') { const value=Number(row.jobCount); if(!Number.isNaN(value)&&value>=0)count=value; }
   else if(row.categoryCounts&&typeof row.categoryCounts==='object')count=Object.values(row.categoryCounts).reduce<number>((sum,value)=>sum+(Number(value)||0),0);
   if(!String(row.companyName||'').trim()||count<=0)continue;
   const id=portal.toLowerCase()+'::'+url,revision=Date.parse(row.updatedAt||row.uploadedAt||'')||0,previous=best.get(id);
   if(!previous||revision>previous.time)best.set(id,{key,row,time:revision});
  }
 }
 const projected:Record<string,any[]>={};
 for(const {key,row}of best.values())(projected[key]||=[]).push(row);
 trackerViews.set(sheets, projected);
 return projected;
}
