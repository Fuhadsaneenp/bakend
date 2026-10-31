const dayViews = new WeakMap<object, Map<string, object>>();
/** Return the requested day's editable sheets plus activity published/edited that day. */
export function dataEntryDayView<T extends { uploadedAt?: string; updatedAt?: string; activityType?: string }>(sheets:Record<string,T[]>, date:string):Record<string,T[]> {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid sheet date');
  const cached = dayViews.get(sheets)?.get(date);
  if (cached) return cached as Record<string,T[]>;
  const day=(value?:string)=>{if(!value)return '';const time=Date.parse(value);return Number.isFinite(time)?new Date(time+19800000).toISOString().slice(0,10):''};
  const result:Record<string,T[]>={};
  for(const [key,rows] of Object.entries(sheets)){
    if(key.startsWith('__'))continue;
    const keyDate=key.match(/-(?:Jobs|Employer|SMM)-(\d{4}-\d{2}-\d{2})(?:-|$)/)?.[1];
    if(keyDate===date){result[key]=rows;continue;}
    const selected=rows.filter(row=>day(row.activityType==='edited'?row.updatedAt||row.uploadedAt:row.uploadedAt||row.updatedAt)===date);
    if(selected.length)result[key]=selected;
  }
  const cachedViews = dayViews.get(sheets) || new Map<string, object>();
  if(cachedViews.size >= 8) cachedViews.clear();
  cachedViews.set(date, result); dayViews.set(sheets, cachedViews);
  return result;
}
