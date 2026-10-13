import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { listing } from "./extract.js";
import { validateUrl } from "./fetch.js";
import type { Listing, Source } from "./types.js";

// This adapter uses an isolated public browser session, never an employee session.
export function isGemsBrowserSource(s: Source) {
  const u = new URL(s.url);
  return u.protocol === "https:" && u.hostname === "careers.gemseducation.com" && u.pathname === "/en/job-search-results/";
}
export function gemsListing(raw: any, s: Source): Listing | null {
  const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value;
  return listing({title:raw.title,id:raw.id,url:raw.url,company:raw.companyName,location:raw.loc,datePosted:date(raw.crtDate),validThrough:date(raw.expDate),description:raw.desc,category:raw.industry,designation:raw.role,experience:raw.exp,employmentType:raw.empType,qualifications:raw.degree}, s, s.url);
}
export async function collectGems(s: Source): Promise<{jobs: Listing[]; warning: string}> {
  if (!isGemsBrowserSource(s)) throw Error("Unsupported browser source");
  const chrome = process.env.JOB_MONITOR_BROWSER_PATH || (process.platform === "darwin" && existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
  const browser = await chromium.launch({headless:true,...(chrome ? {executablePath:chrome} : {})});
  try {
    const context = await browser.newContext({serviceWorkers:"block"});
    const checked = new Set<string>();
    await context.route("**/*", async route => {
      const request=route.request(), u=new URL(request.url());
      const permittedHost=u.hostname==="careers.gemseducation.com" || /^(?:tjscf|timg0cf)\.b8cdn\.com$/.test(u.hostname);
      if(u.protocol!=="https:" || !permittedHost || ["image","media","font"].includes(request.resourceType()) || request.method()!=="GET") return route.abort();
      try { if(!checked.has(u.hostname)){await validateUrl(u.origin);checked.add(u.hostname);}await route.continue(); } catch { await route.abort(); }
    });
    const page = await context.newPage();page.setDefaultTimeout(25000);
    const response = () => page.waitForResponse(r => new URL(r.url()).hostname === "careers.gemseducation.com" && new URL(r.url()).pathname === "/app/control/byt_job_search_manager" && r.request().method()==="GET" && r.ok(), {timeout:30000});
    const initial=response();
    await page.goto(s.url,{waitUntil:"domcontentloaded",timeout:45000});
    let data = await (await initial).json();
    const sort=page.locator('select:has(option[value="28,d"])');
    if(await sort.inputValue()!=="28,d"){const next=response();await sort.selectOption("28,d");data=await (await next).json();}
    const jobs:Listing[]=[];let warning="";const cutoff=Date.now()-48*3600000;const deadline=Date.now()+180000;
    for(let index=1;index<=40;index++){
      if(!Array.isArray(data.jobs))throw Error("GEMS did not return readable public jobs");
      const batch=data.jobs.map((raw:any)=>gemsListing(raw,s)).filter((j:Listing|null):j is Listing=>!!j);jobs.push(...batch);
      const dates=batch.map((j:Listing)=>Date.parse(j.postedDate));
      if(!batch.length || dates.every((date:number)=>Number.isFinite(date)&&date<cutoff) || index*batch.length>=Number(data.totalJobs))break;
      const pagination=page.locator('.pagination select');
      if(!await pagination.count())break;
      if(index===40 || Date.now()>deadline){warning="Browser scan limit reached before all recent listings were checked.";break;}
      await page.waitForTimeout(1000);
      const next=response();await pagination.selectOption(String(index+1));data=await (await next).json();
    }
    return {jobs,warning};
  } finally { await browser.close(); }
}

export function isReemBrowserSource(s: Source) {
  const u=new URL(s.url);
  return u.protocol==="https:" && u.hostname==="career22.sapsf.com" && u.pathname==="/career" && u.searchParams.get("company")==="blueappleh";
}
export function reemListing(raw: {title:string;id:string;date:string},s:Source):Listing|null {
  const match=raw.date.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const url=new URL("https://career22.sapsf.com/career");
  url.search=new URLSearchParams({company:"blueappleh",career_ns:"job_listing",career_job_req_id:raw.id,navBarLevel:"JOB_SEARCH",selected_lang:"en_GB"}).toString();
  return listing({title:raw.title,id:raw.id,company:s.name,datePosted:match?`${match[3]}-${match[2]}-${match[1]}`:"",url:url.href},s,s.url);
}
export async function collectReem(s:Source):Promise<{jobs:Listing[];warning:string}> {
  if(!isReemBrowserSource(s))throw Error("Unsupported browser source");
  const chrome=process.env.JOB_MONITOR_BROWSER_PATH || (process.platform==="darwin"&&existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":undefined);
  const browser=await chromium.launch({headless:true,...(chrome?{executablePath:chrome}:{})});
  try {
    await validateUrl("https://career22.sapsf.com");
    const context=await browser.newContext({serviceWorkers:"block"});
    await context.route("**/*",async route=>{
      const request=route.request(),u=new URL(request.url());
      if(u.protocol!=="https:" || u.hostname!=="career22.sapsf.com" || ["image","media","font"].includes(request.resourceType()) || !["GET","POST"].includes(request.method()))return route.abort();
      await route.continue();
    });
    const page=await context.newPage();page.setDefaultTimeout(30000);
    // Session query strings are not persisted or reused between scans.
    await page.goto("https://career22.sapsf.com/career?company=blueappleh&career_ns=job_listing_summary&navBarLevel=JOB_SEARCH",{waitUntil:"domcontentloaded",timeout:45000});
    await page.locator("tr.jobResultItem a.jobTitle").first().waitFor();
    if(await page.locator('select[name="sort by"]').first().inputValue()!=="JOB_START_DATE")throw Error("Reem listings are not ordered by posting date");
    const jobs:Listing[]=[];let warning="";const cutoff=Date.now()-48*3600000,deadline=Date.now()+180000;let lastDate=Infinity;
    for(let index=0;index<40;index++){
      const rows=await page.locator("tr.jobResultItem").evaluateAll(nodes=>nodes.map(node=>({title:node.querySelector("a.jobTitle")?.textContent?.trim()||"",id:node.querySelector(".jobContentEM")?.textContent?.trim()||"",date:node.querySelector(".noteSection")?.textContent||""})));
      const batch=rows.map(raw=>reemListing(raw,s)).filter((j):j is Listing=>!!j);
      for(const j of batch){const date=Date.parse(j.postedDate);if(Number.isFinite(date)){if(date>lastDate)throw Error("Reem posting-date order changed; scan deferred");lastDate=date;}}
      jobs.push(...batch);
      if(batch.some(j=>Number.isFinite(Date.parse(j.postedDate))&&Date.parse(j.postedDate)<cutoff))break;
      const next=page.locator('a[title="Next Page"]').first();
      if(!await next.count() || await next.getAttribute("aria-disabled")==="true" || (await next.getAttribute("class"))?.includes("disabled"))break;
      if(Date.now()>deadline || index===39){warning="Browser scan limit reached before all recent Reem listings were checked.";break;}
      const previous=rows[0]?.id;await next.click();
      await page.waitForFunction(id=>document.querySelector("tr.jobResultItem .jobContentEM")?.textContent?.trim()!==id,previous);
    }
    return {jobs,warning};
  } finally {await browser.close();}
}
