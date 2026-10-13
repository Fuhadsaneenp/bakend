import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
const UA="STEMSJobMonitor/1.0";
export function publicAddress(ip:string): boolean {
  if(isIP(ip)===4) { const [a,b]=ip.split(".").map(Number); return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19].includes(b)); }
  if(isIP(ip)===6) { const s=ip.toLowerCase(); return /^[23]/.test(s) && !s.startsWith("2001:db8") && !s.startsWith("2002:") && !s.startsWith("2001:0:"); }
  return false;
}
export function parsePublicUrl(value:string): URL {
  const u=new URL(value); if(!/^https?:$/.test(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port)))throw Error("Use a public HTTP/HTTPS URL without credentials or custom ports");
  const host=u.hostname.replace(/^\[|\]$/g,"");if(isIP(host)&&!publicAddress(host))throw Error("Private, loopback and reserved network addresses are not allowed");if(host==="localhost"||host.endsWith(".localhost")||!host.includes("."))throw Error("Use a public hostname");return u;
}
async function addressesFor(host: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([lookup(host,{all:true}),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error("Source DNS lookup timed out")),5000);})]); }
  finally { if(timer)clearTimeout(timer); }
}
export async function validateUrl(value:string): Promise<URL> {
  const u=parsePublicUrl(value);
  const addresses=await addressesFor(u.hostname.replace(/^\[|\]$/g,"")); if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error("Private, loopback and reserved network addresses are not allowed"); return u;
}
const hostNext=new Map<string,number>();
export async function fetchPublic(value:string,headers:Record<string,string>={},redirects=0):Promise<{body:string;status:number;url:string;headers:Record<string,string>}> {
  const u=await validateUrl(value); const addresses=await addressesFor(u.hostname.replace(/^\[|\]$/g,""));if(addresses.some(a=>!publicAddress(a.address)))throw Error("Blocked address");
  const delay=Math.max(0,(hostNext.get(u.hostname)||0)-Date.now());hostNext.set(u.hostname,Date.now()+delay+1000); if(delay)await new Promise(r=>setTimeout(r,delay));
  const result=await new Promise<{body:string;status:number;url:string;headers:Record<string,string>}>((resolve,reject)=>{
    const pinned=addresses[0];const req=(u.protocol==="https:"?httpsRequest:httpRequest)(u,{headers:{"User-Agent":UA,"Accept":"application/json,application/xml,text/html;q=0.9,*/*;q=0.5","Accept-Encoding":"identity",...headers},lookup:(_hostname:any,options:any,cb:any)=>options?.all ? cb(null,[{address:pinned.address,family:pinned.family}]) : cb(null,pinned.address,pinned.family)},res=>{
      let size=0;const chunks:Buffer[]=[];
      res.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>5*1024*1024){req.destroy(Error("Response exceeds 5 MB"));return;}chunks.push(chunk);});
      res.on("error",reject);res.on("end",()=>resolve({body:Buffer.concat(chunks).toString("utf8"),status:res.statusCode||0,url:u.href,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(","):v||""]))}));
    });const timer=setTimeout(()=>req.destroy(Error("Source request timed out after 20 seconds")),20000);req.on("close",()=>clearTimeout(timer));req.on("error",reject);req.end();
  });
  if([301,302,303,307,308].includes(result.status)&&result.headers.location){if(redirects>=4)throw Error("Too many redirects");const target=new URL(result.headers.location,u).href;return fetchPublic(target,{},redirects+1);}
  return result;
}
export function robotsAllows(body:string,url:string):boolean {
  const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];let current={agents:[] as string[],rules:[] as {allow:boolean;path:string}[]};
  for(const line of body.split(/\r?\n/)){const clean=line.split("#")[0];const colon=clean.indexOf(":");if(colon<0)continue;const key=clean.slice(0,colon).trim().toLowerCase(),value=clean.slice(colon+1).trim();if(key==="user-agent"){if(current.rules.length){groups.push(current);current={agents:[],rules:[]};}current.agents.push(value.toLowerCase());}else if(["allow","disallow"].includes(key)&&current.agents.length&&value)current.rules.push({allow:key==="allow",path:value});}groups.push(current);
  const specific=groups.filter(g=>g.agents.some(a=>a!=="*"&&UA.toLowerCase().includes(a)));const applicable=specific.length?specific:groups.filter(g=>g.agents.includes("*"));const path=new URL(url).pathname+new URL(url).search;
  const matching=applicable.flatMap(g=>g.rules).filter(r=>{const pattern=r.path.replace(/[.+?^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*").replace(/\\\$$/,"$");return new RegExp("^"+pattern).test(path);}).sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));return matching[0]?.allow??true;
}
const robotsCache=new Map<string,{at:number;body:string}>();
export async function allowed(url:string) { const origin=new URL(url).origin;let robots=robotsCache.get(origin);if(!robots||Date.now()-robots.at>3600000){const r=await fetchPublic(origin+"/robots.txt");if(r.status>=500||r.status===429)throw Error("robots.txt unavailable; scan deferred");robots={at:Date.now(),body:r.status>=200&&r.status<300?r.body:""};robotsCache.set(origin,robots);}if(!robotsAllows(robots.body,url))throw Error("Source disallows STEMSJobMonitor in robots.txt"); }
