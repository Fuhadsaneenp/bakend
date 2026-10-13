import { collectGems, isGemsBrowserSource, collectReem, isReemBrowserSource } from "./browser.js";
import { randomUUID } from "node:crypto";
import { purgeUnqualified, db, transaction, sources, source, saveSource, saveJob, job, enqueue, lease } from "./store.js";
import { extract, identities, hash, canonical } from "./extract.js";
import { fetchPublic, allowed } from "./fetch.js";
import type { Listing, Job, Source } from "./types.js";
export function importListings(s:Source,listings:Listing[],now=new Date().toISOString()) {
  return transaction(()=>{let imported=0,duplicates=0,possible=0;const detectedIds:string[]=[];const urls:string[]=[];
    for(const listing of listings) {
      const posted = Date.parse(listing.postedDate);
      const detected = Date.parse(now);
      if (!Number.isFinite(posted) || posted < detected - 48 * 3600000 || posted > detected) continue;

      const ids=identities(listing,s.id); const prefix=`${s.postingWebsite||"Medbiomate"}:`;ids.strong=ids.strong.map(identity=>prefix+identity);if(ids.fingerprint)ids.fingerprint=prefix+ids.fingerprint; const occurrenceIdentity=ids.strong[0]||ids.fingerprint||`raw:${hash(JSON.stringify(listing.raw))}`;
      detectedIds.push(listing.sourceJobId||occurrenceIdentity); if(listing.originalUrl)urls.push(listing.originalUrl);
      const seen=db().prepare("SELECT job FROM occurrences WHERE source=? AND identity=?").get(s.id,occurrenceIdentity);
      if(seen){db().prepare("UPDATE occurrences SET lastSeen=? WHERE source=? AND identity=?").run(now,s.id,occurrenceIdentity);continue;}
      let duplicate:string|undefined;let reason="";
      for(const identity of ids.strong){const match=db().prepare("SELECT job FROM identities WHERE company=? AND identity=?").get(s.companyId,identity);if(match){duplicate=match.job;reason=identity.startsWith("id:")?"Source job ID":identity.startsWith("url:")?"Canonical/original URL":"Matching content";break;}}
      if(duplicate){duplicates++;db().prepare("INSERT INTO occurrences VALUES(?,?,?,?,?)").run(s.id,occurrenceIdentity,duplicate,now,now);continue;}
      const weak=ids.fingerprint?db().prepare("SELECT job FROM identities WHERE company=? AND identity=?").get(s.companyId,ids.fingerprint):null;
      const j:Job={...listing,postingWebsite:s.postingWebsite,id:randomUUID(),companyId:s.companyId,sourceId:s.id,sourceWebsite:s.website,sourceUrl:s.url,detectedAt:now,importedAt:now,status:weak?"Possible Duplicate":"New",duplicateOf:weak?.job,duplicateReason:weak?"Company, title and location match; review distinct vacancies":"",updatedAt:now,version:1};
      if(j.closingDate&&Number.isFinite(Date.parse(j.closingDate))&&Date.parse(j.closingDate)<Date.parse(now))j.status="Expired";
      saveJob(j);for(const identity of [...ids.strong,...(ids.fingerprint?[ids.fingerprint]:[])])db().prepare("INSERT INTO identities VALUES(?,?,?) ON CONFLICT DO NOTHING").run(s.companyId,identity,j.id);
      db().prepare("INSERT INTO occurrences VALUES(?,?,?,?,?)").run(s.id,occurrenceIdentity,j.id,now,now);imported++;if(weak)possible++;
    }
    return {imported,duplicates,possible,detectedIds:[...new Set(detectedIds)],urls:[...new Set(urls)]};
  });
}
async function scan(s:Source,token:string) {
  const id=randomUUID(),started=new Date().toISOString();db().prepare("INSERT INTO scans(id,company,source,started) VALUES(?,?,?,?)").run(id,s.companyId,s.id,started);
  try {
    const oracle=new URL(s.url),site=oracle.hostname.endsWith(".oraclecloud.com")?oracle.pathname.match(/CandidateExperience\/[^/]+\/sites\/([^/]+)/)?.[1]:undefined;
    const fetchUrl=site?`${oracle.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${encodeURIComponent(site)},limit=100,sortBy=POSTING_DATES_DESC`:s.url;
    if(!isGemsBrowserSource(s)&&!isReemBrowserSource(s))await allowed(fetchUrl);const headers:Record<string,string>={};if(s.etag)headers["If-None-Match"]=s.etag;if(s.lastModified)headers["If-Modified-Since"]=s.lastModified;
    const browserResult=isGemsBrowserSource(s)?await collectGems(s):isReemBrowserSource(s)?await collectReem(s):null;
    const r=browserResult?{status:200,body:JSON.stringify(browserResult.jobs),url:s.url,headers:{} as Record<string,string>}:await fetchPublic(fetchUrl,headers);if(r.status!==304&&(r.status<200||r.status>=300))throw Error(`Source returned HTTP ${r.status}`);
    let warning="",all:Listing[]=[];
    if(browserResult){all=browserResult.jobs;warning=browserResult.warning;}
    else if(r.status!==304){let body=r.body;
      if(site){const data=JSON.parse(body);body=JSON.stringify((data.items?.[0]?.requisitionList||[]).map((j:any)=>({title:j.Title,company:j.LegalEmployer||s.name,location:j.PrimaryLocation,country:j.PrimaryLocationCountry,id:j.Id,datePosted:j.PostedDate,validThrough:j.PostingEndDate,description:j.ShortDescriptionStr,qualifications:j.ExternalQualificationsStr,requirements:j.ExternalResponsibilitiesStr,department:j.Department,url:`${oracle.origin}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}`,oracleData:j})));}
      const parsed=extract(body,s,r.url);all=parsed.jobs;warning=parsed.warning;
      for (const feedUrl of parsed.feeds.slice(0,3)) { try { await allowed(feedUrl); const feed=await fetchPublic(feedUrl);if(feed.status>=200&&feed.status<300){const preferred=extract(feed.body,s,feed.url);if(preferred.jobs.length){all=preferred.jobs;warning=preferred.warning;break;}} } catch { /* Fall back to structured data / HTML. */ } }
      // Bounded same-site discovery: feeds and sitemap URLs can link to job detail pages.
      const pending=parsed.urls.filter(u=>new URL(u).origin===new URL(s.url).origin);const visited=new Set<string>([canonical(s.url)]);let fetched=0;
      while(pending.length&&fetched<40&&Date.now()-Date.parse(started)<180000){const url=pending.shift()!;if(visited.has(url))continue;visited.add(url);fetched++;
        try {await allowed(url);const page=await fetchPublic(url);if(page.status<200||page.status>=300)throw Error(`HTTP ${page.status}`);const child=extract(page.body,{...s,config:{...s.config,listPath:undefined}},page.url);all.push(...child.jobs);pending.push(...child.urls.filter(u=>new URL(u).origin===new URL(s.url).origin&&!visited.has(u)));if(!child.jobs.length&&!child.urls.length)warning="Some detail pages need extraction configuration";}catch(e){warning=`Some linked pages failed: ${e instanceof Error?e.message:"unknown error"}`;}
      }
      if(pending.length)warning="Discovery limit reached (40 pages / 3 minutes). Use a job feed/API or split this source into smaller sitemaps.";
    }
    // An expired lease cannot commit a scan after another worker claimed it.
    if(!db().prepare("SELECT source FROM queue WHERE source=? AND token=? AND state='running'").get(s.id,token))return;
    const now=new Date().toISOString();const stats=importListings(s,all,now);const latest=source(s.companyId,s.id)!;const changed=r.status!==304&&latest.contentHash!==hash(r.body);
    saveSource({...latest,lastAutomaticCheck:now,lastSuccessfulCheck:now,lastError:"",health:!latest.active?"Inactive":warning?"Warning":"Working",lastChangeDetected:changed?now:latest.lastChangeDetected,contentHash:r.status===304?latest.contentHash:hash(r.body),previousJobIds:r.status===304?latest.previousJobIds:stats.detectedIds,previousUrls:r.status===304?latest.previousUrls:stats.urls,totalListings:r.status===304?latest.totalListings:all.length,jobsDetected:latest.jobsDetected+stats.imported,nextCheckAt:new Date(Date.now()+latest.frequencyHours*3600000).toISOString(),etag:r.headers.etag||latest.etag,lastModified:r.headers["last-modified"]||latest.lastModified});
    db().prepare("UPDATE scans SET finished=?,newJobs=?,duplicates=?,duration=?,warning=? WHERE id=?").run(now,stats.imported,stats.duplicates,Date.now()-Date.parse(started),warning,id);
    db().prepare("DELETE FROM queue WHERE source=? AND token=?").run(s.id,token);
  }catch(e){if(!db().prepare("SELECT source FROM queue WHERE source=? AND token=? AND state='running'").get(s.id,token))return;const message=(e instanceof Error?e.message:"Scan failed").slice(0,1000),now=new Date().toISOString();const latest=source(s.companyId,s.id);if(latest)saveSource({...latest,lastAutomaticCheck:now,lastError:message,health:latest.active?"Failed":"Inactive",nextCheckAt:new Date(Date.now()+latest.frequencyHours*3600000).toISOString()});
    db().prepare("UPDATE scans SET finished=?,duration=?,error=? WHERE id=?").run(now,Date.now()-Date.parse(started),message,id);
    const q=db().prepare("SELECT attempts FROM queue WHERE source=? AND token=?").get(s.id,token);if(q&&q.attempts<3)db().prepare("UPDATE queue SET state='queued',available=?,error=?,token=NULL WHERE source=? AND token=?").run(new Date(Date.now()+Math.min(3600000,60000*2**q.attempts)).toISOString(),message,s.id,token);else db().prepare("DELETE FROM queue WHERE source=? AND token=?").run(s.id,token);
  }
}
let timer:ReturnType<typeof setInterval>|undefined;let running=0;
export function startJobMonitor() { if(timer)return; const tick=()=>{try {
  const now=new Date().toISOString();purgeUnqualified(now);for(const s of sources())if(s.active&&s.nextCheckAt<=now)enqueue(s);
  // Expiration uses only an explicit source closing date.
  for(const r of db().prepare("SELECT company,id,payload FROM jobs WHERE status NOT IN ('Expired','Rejected','Duplicate')").all()){const j=JSON.parse(r.payload) as Job;if(j.closingDate&&Number.isFinite(Date.parse(j.closingDate))&&Date.parse(j.closingDate)<Date.now())saveJob({...j,status:"Expired",version:j.version+1,updatedAt:now});}
  while(running<4){const q=lease();if(!q)break;const s=source(q.company,q.source);if(!s)continue;running++;void scan(s,q.token).finally(()=>running--);}
  }catch(e){console.error("Job monitor tick failed",e instanceof Error?e.message:"unknown");}};tick();timer=setInterval(tick,15000);timer.unref(); }
