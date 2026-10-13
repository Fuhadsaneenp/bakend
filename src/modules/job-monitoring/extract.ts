import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import type { Listing, Source } from "./types.js";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
export function canonical(value: string,base?: string): string { if (!value.trim()) return ""; try { const u = new URL(value,base); if (!/^https?:$/.test(u.protocol)) return ""; u.hash=""; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k); u.searchParams.sort(); u.hostname=u.hostname.toLowerCase(); u.pathname=u.pathname.replace(/\/+$/,"") || "/"; return u.href; } catch { return ""; } }
const text = (v: any): string => v == null ? "" : typeof v === "string" ? v.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim() : typeof v === "number" ? String(v) : Array.isArray(v) ? v.map(text).filter(Boolean).join(", ") : text(v.name || v.value || v.description || "");
const path = (obj: any,p: string) => p.split(".").reduce((v,k) => v?.[k],obj);
export function listing(raw: any,s: Source,base: string): Listing | null {
  if (!raw || typeof raw !== "object") return null;
  const field = (key: string,...fallbacks: string[]) => s.config.fields?.[key] ? path(raw,s.config.fields[key]) : fallbacks.map(p => path(raw,p)).find(v=>v != null);
  const address = raw.jobLocation?.address || raw.jobLocation?.[0]?.address || {};
  const title = text(field("title","title","jobTitle","name")); if (!title) return null;
  const salary = field("salary","baseSalary","salary");
  return { title, employer: text(field("employer","hiringOrganization.name","company.name","company","employer")) || s.config.employer || s.name,
    location: text(field("location","location","location.name")) || [address.addressLocality,address.addressRegion].map(text).filter(Boolean).join(", "),
    emirate: text(field("emirate","emirate")),country: text(field("country","country")) || text(address.addressCountry) || s.country,
    category: text(field("category","occupationalCategory","category")) || s.category, designation: text(field("designation","designation")), department: text(field("department","employmentUnit.name","department")),
    description: text(field("description","description","content","summary")),requirements:text(field("requirements","skills","requirements")),experience:text(field("experience","experienceRequirements","experience")),qualification:text(field("qualification","educationRequirements","qualifications","qualification")),
    salary: typeof salary === "object" && salary ? [text(salary.currency),text(salary.value?.minValue || salary.value?.value || salary.value),salary.value?.maxValue ? `– ${text(salary.value.maxValue)}` : "",text(salary.value?.unitText)].filter(Boolean).join(" ") : text(salary),
    employmentType: text(field("employmentType","employmentType","type")),postedDate:text(field("postedDate","datePosted","postedDate","pubDate","published")),closingDate:text(field("closingDate","validThrough","closingDate")),
    originalUrl:canonical(text(field("originalUrl","originalUrl","url","link","absolute_url","hostedUrl")),base),canonicalUrl:canonical(text(field("canonicalUrl","canonicalUrl")),base),sourceJobId:text(field("sourceJobId","sourceJobId","identifier.value","identifier","id","guid")),raw };
}
export function identities(j: Listing,sourceId: string): {strong: string[]; fingerprint: string} {
  const strong: string[]=[]; if (j.sourceJobId) strong.push(`id:${sourceId}:${j.sourceJobId}`);
  for (const url of [j.canonicalUrl,j.originalUrl]) if (url) strong.push(`url:${canonical(url)}`);
  if (j.description && j.employer && j.title) strong.push(`content:${hash(normalize(j.employer)+"|"+normalize(j.title)+"|"+normalize(j.location)+"|"+normalize(j.description))}`);
  return {strong:[...new Set(strong)],fingerprint:j.employer && j.title ? `fingerprint:${hash(normalize(j.employer)+"|"+normalize(j.title)+"|"+normalize(j.location))}` : ""};
}
const parse = (body: string,html=false) => new DOMParser({ onError: () => {} }).parseFromString(body,html ? "text/html" : "text/xml");
function descendants(node: any): any[] { const result:any[]=[]; for (let n=node.firstChild;n;n=n.nextSibling) { if(n.nodeType===1) result.push(n,...descendants(n)); } return result; }
function match(node:any,selector:string) { const m=selector.match(/^([\w:-]+)?(?:\.([\w-]+)|#([\w-]+)|\[([\w:-]+)(?:=["']?([^"'\]]+)["']?)?\])?$/); if(!m) throw Error("HTML selectors support a tag, .class, #id or [attribute=value]"); return (!m[1] || node.tagName?.toLowerCase()===m[1].toLowerCase()) && (!m[2] || (node.getAttribute("class")||"").split(/\s+/).includes(m[2])) && (!m[3] || node.getAttribute("id")===m[3]) && (!m[4] || (m[5] ? node.getAttribute(m[4])===m[5] : node.hasAttribute(m[4]))); }
export function extract(body: string,s: Source,base = s.url): {jobs: Listing[]; urls: string[]; feeds: string[]; warning: string} {
  let raws:any[]=[]; const urls:string[]=[]; const feeds:string[]=[]; let warning="";
  const trimmed=body.trim();
  if (/^[\[{]/.test(trimmed)) {
    const data=JSON.parse(body); const root=s.config.listPath ? path(data,s.config.listPath) : Array.isArray(data) ? data : data.jobs || data.results || data.items || data.data || data;
    raws=Array.isArray(root) ? root : [root];
    if (!s.config.listPath && !Array.isArray(root) && !root?.title && !root?.jobTitle) { const visit=(o:any,depth=0) => { if(depth>12 || !o || typeof o!=="object")return; if([o["@type"]].flat().includes("JobPosting"))raws.push(o); else Object.values(o).forEach(v=>Array.isArray(v)?v.forEach(x=>visit(x,depth+1)):visit(v,depth+1)); }; raws=[];visit(data); }
  } else if (/<(?:\w+:)?(?:rss|feed|urlset|sitemapindex|jobs)\b/i.test(body)) {
    const doc=parse(body); if (!doc || doc.getElementsByTagName("parsererror").length) throw Error("Invalid XML feed");
    const nodes=descendants(doc);
    if(nodes.some(n=>/^(urlset|sitemapindex)$/.test(n.localName))) { for(const n of nodes.filter(n=>n.localName==="loc")) { const u=canonical(n.textContent,base);if(u)urls.push(u); } }
    else for(const n of nodes.filter(n=>["item","entry","job"].includes(n.localName))) { const raw:any={};for(const c of descendants(n)) if(c.parentNode===n)raw[c.localName]=c.localName==="link"?(c.getAttribute("href")||c.textContent):c.textContent; raws.push(raw); }
  } else {
    if (s.type === "Auto") for (const m of body.matchAll(/<link\b[^>]*>/gi)) {
      const tag=m[0]; const rel=tag.match(/rel\s*=\s*["']([^"']+)["']/i)?.[1]; const type=tag.match(/type\s*=\s*["']([^"']+)["']/i)?.[1];const href=tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
      if(rel?.split(/\s+/).includes("alternate") && /(?:rss|atom|json|xml)/i.test(type||"") && href){const u=canonical(href,base);if(u&&new URL(u).origin===new URL(base).origin)feeds.push(u);}
    }
    for(const m of body.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { const data=JSON.parse(m[1]); const visit=(o:any,depth=0)=>{if(depth>12||!o||typeof o!=="object")return;if([o["@type"]].flat().includes("JobPosting"))raws.push(o);else Object.values(o).forEach(v=>Array.isArray(v)?v.forEach(x=>visit(x,depth+1)):visit(v,depth+1));};visit(data); } catch { warning="Some structured data could not be parsed"; }
    }
    if(!raws.length && /class=["'][^"']*jobTitle-link/.test(body)) {
      const doc=parse(body,true);
      if(doc)for(const row of descendants(doc).filter(n=>n.tagName?.toLowerCase()==="tr"&&(n.getAttribute("class")||"").split(/\s+/).includes("data-row"))){
        const nodes=descendants(row),link=nodes.find(n=>(n.getAttribute("class")||"").split(/\s+/).includes("jobTitle-link"));
        const date=nodes.find(n=>(n.getAttribute("class")||"").split(/\s+/).includes("jobDate"));
        const location=nodes.find(n=>(n.getAttribute("class")||"").split(/\s+/).includes("jobLocation"));
        if(link)raws.push({title:text(link.textContent),url:link.getAttribute("href"),company:s.name,location:text(location?.textContent),datePosted:text(date?.textContent),id:link.getAttribute("href")?.match(/\/(\d+)\/?$/)?.[1]});
      }
    }
    if(!raws.length && s.config.jobSelector) {
      const doc=parse(body,true); if(!doc)throw Error("Cannot parse HTML");
      for(const node of descendants(doc).filter(n=>match(n,s.config.jobSelector!))) { const raw:any={}; for(const [key,selector] of Object.entries(s.config.fields || {})) { const [sel,attr]=selector.split("@"); const found=[node,...descendants(node)].find(n=>match(n,sel));raw[key]=found ? attr ? found.getAttribute(attr) : found.textContent : ""; } raws.push(raw); }
      // The configured selectors have already produced named fields.
      s={...s,config:{...s.config,fields:undefined}};
    }
    if(s.config.jobLinkPattern) for(const m of body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) { const u=canonical(m[1],base);if(u && new URL(u).pathname.includes(s.config.jobLinkPattern))urls.push(u); }
  }
  const jobs=raws.slice(0,5000).map(r=>listing(r,s,base)).filter((j):j is Listing=>!!j);
  if(!jobs.length&&!urls.length)warning=warning || "No readable job listings. Configure the API list path, HTML selectors or job link path; JavaScript-only pages need a feed/API.";
  return {jobs,urls:[...new Set(urls)],feeds:[...new Set(feeds)],warning};
}
