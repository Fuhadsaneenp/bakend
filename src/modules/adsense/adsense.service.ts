import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { day, offset, range, sites, digest, encrypt, decrypt, reportQuery, parseReport } from "./adsense.domain.js";
export const CONNECTION = "adsense_connection_v1";
const connectionKey = (domain: string) => `${CONNECTION}:${domain}`;
const leaseKey = (domain: string) => `adsense_sync_lease_v1:${domain}`;
const SCOPE = "https://www.googleapis.com/auth/adsense.readonly";
type Site = { domain: string; account: string; siteId: string; timeZone: string; lastSyncAt?: string };
type Connection = { access: string; refresh: string; expires: number; sites: Site[]; generation: string; lastAttempt?: number; status: "CONNECTED" | "RECONNECT_REQUIRED"; error?: string };
export const isAdmin = (u: { role: string }) => ["SUPER_ADMIN", "HR_ADMIN"].includes(u.role);
export function company(u: AuthUser) { if (!u.companyId) throw new ApiError(400, "Company context required"); return u.companyId; }
function config() {
  const clientId = process.env.ADSENSE_GOOGLE_CLIENT_ID || process.env.SEO_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.ADSENSE_GOOGLE_CLIENT_SECRET || process.env.SEO_GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.ADSENSE_GOOGLE_REDIRECT_URI || process.env.SEO_GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new ApiError(503, "AdSense Google OAuth is not configured");
  return { clientId, clientSecret, redirectUri };
}
export function configured() { try { config(); encrypt("configuration-check"); return true; } catch { return false; } }
async function setting(companyId: string, key: string) { return prisma.companySetting.findUnique({ where: { companyId_key: { companyId, key } } }); }
async function put(companyId: string, key: string, value: any) { return prisma.companySetting.upsert({ where: { companyId_key: { companyId, key } }, create: { companyId, key, value }, update: { value } }); }
async function connectionRow(companyId: string, domain: string) {
  const specific = await setting(companyId, connectionKey(domain));
  if (specific) return specific;
  const legacy = await setting(companyId, CONNECTION);
  return (legacy?.value as unknown as Connection | undefined)?.sites.some(site => site.domain === domain) ? legacy : null;
}
async function connection(companyId: string, domain: string): Promise<Connection> {
  const row = await connectionRow(companyId, domain);
  if (!row) throw new ApiError(409, `Connect Google for ${domain} first`);
  return row.value as any;
}
async function tokens(body: Record<string, string>) {
  const c = config();
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ ...body, client_id: c.clientId, client_secret: c.clientSecret }), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new ApiError(r.status === 400 ? 401 : 502, "Google authorization expired or failed; reconnect AdSense");
  const data = await r.json() as any;
  if (!data.access_token || !Number.isFinite(Number(data.expires_in)) || (data.scope && !data.scope.split(" ").includes(SCOPE))) throw new ApiError(502, "Google did not grant AdSense read-only access");
  return data;
}
async function google(access: string, path: string, query = new URLSearchParams()): Promise<any> {
  if (!/^accounts(?:\/pub-\d+(?:\/sites|\/reports:generate)?)?$/.test(path)) throw new ApiError(400, "Invalid AdSense resource");
  const r = await fetch(`https://adsense.googleapis.com/v2/${path}?${query}`, { headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new ApiError(r.status === 401 ? 401 : 502, r.status === 403 ? "AdSense access denied. Enable the AdSense Management API and reconnect with read-only access." : `AdSense request failed (${r.status}); retry or reconnect`);
  return r.json();
}
async function pages(access: string, path: string, field: string) {
  const rows: any[] = []; let token = "";
  do { const query = new URLSearchParams({ fields: field === "accounts" ? "accounts(name,timeZone),nextPageToken" : "sites(domain,reportingDimensionId),nextPageToken" }); if (token) query.set("pageToken", token); const result = await google(access, path, query); rows.push(...(result[field] || [])); token = result.nextPageToken || ""; } while (token);
  return rows;
}
async function discover(access: string) {
  const found: Site[] = [];
  for (const account of await pages(access, "accounts", "accounts")) {
    for (const site of await pages(access, `${account.name}/sites`, "sites")) {
      const domain = String(site.domain).toLowerCase().replace(/^www\./, "");
      if (!sites.includes(domain as any) || !site.reportingDimensionId) continue;
      if (found.some(s => s.domain === domain)) throw new ApiError(409, "A website appears in multiple AdSense accounts; use a Google account with unambiguous site access");
      const timeZone = account.timeZone?.id || "America/Los_Angeles"; day(timeZone);
      found.push({ domain, account: account.name, siteId: site.reportingDimensionId, timeZone });
    }
  }
  if (!found.length) throw new ApiError(400, "Neither trikonet.com nor medbiomate.com is accessible in this AdSense account");
  return found;
}
export async function begin(u: AuthUser, website = "trikonet.com") {
  if (!sites.includes(website as any)) throw new ApiError(400, "Unsupported website");
  const c = config(), companyId = company(u), state = `adsense.${randomBytes(32).toString("base64url")}`, verifier = randomBytes(32).toString("base64url");
  await put(companyId, `adsense_oauth:${digest(state)}`, { userId: u.id, website, expires: Date.now() + 600000, verifier: encrypt(verifier) });
  const query = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.redirectUri, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent select_account", state, code_challenge: Buffer.from(digest(verifier), "hex").toString("base64url"), code_challenge_method: "S256" });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` };
}
export async function callback(state: string, code: string) {
  if (!state.startsWith("adsense.")) throw new ApiError(400, "Invalid AdSense OAuth state");
  const key = `adsense_oauth:${digest(state)}`, saved = await prisma.companySetting.findFirst({ where: { key } });
  const data = saved?.value as any;
  if (!saved || !data || data.expires < Date.now()) throw new ApiError(400, "AdSense authorization session expired");
  const consumed = await prisma.companySetting.deleteMany({ where: { id: saved.id } });
  if (consumed.count !== 1) throw new ApiError(400, "Authorization session already used");
  const user = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!user?.isActive || !isAdmin(user) || user.companyId !== saved.companyId) throw new ApiError(403, "Administrator access revoked");
  const token = await tokens({ code, grant_type: "authorization_code", redirect_uri: config().redirectUri, code_verifier: decrypt(data.verifier) });
  if (!token.refresh_token) throw new ApiError(400, "Offline authorization is required; reconnect with Google consent");
  const discovered = (await discover(token.access_token)).filter(site => !data.website || site.domain === data.website);
  if (!discovered.length) throw new ApiError(400, `The selected Google account does not have access to ${data.website}`);
  for (const site of discovered) {
    if (await setting(saved.companyId, leaseKey(site.domain))) throw new ApiError(409, "Synchronization is running; reconnect after it completes");
    await put(saved.companyId, connectionKey(site.domain), { access: encrypt(token.access_token), refresh: encrypt(token.refresh_token), expires: Date.now() + token.expires_in * 1000, sites: [site], generation: randomBytes(16).toString("hex"), status: "CONNECTED" });
  }
  return data.website || discovered[0]?.domain;
  // Synchronization runs after callback via the durable daily job; the administrator can also refresh immediately.
}
const refreshes = new Map<string, Promise<string>>();
async function access(companyId: string, domain: string) {
  const c = await connection(companyId, domain);
  if (c.status !== "CONNECTED") throw new ApiError(409, "Reconnect AdSense to continue synchronization");
  if (c.expires > Date.now() + 60000) return decrypt(c.access);
  const existing = refreshes.get(`${companyId}:${domain}`); if (existing) return existing;
  const pending = (async () => {
    const token = await tokens({ grant_type: "refresh_token", refresh_token: decrypt(c.refresh) });
    const fresh = await connection(companyId, domain);
    if (fresh.generation !== c.generation) throw new ApiError(409, "AdSense connection changed");
    await put(companyId, connectionKey(domain), { ...fresh, access: encrypt(token.access_token), refresh: token.refresh_token ? encrypt(token.refresh_token) : fresh.refresh, expires: Date.now() + token.expires_in * 1000 });
    return token.access_token as string;
  })(); refreshes.set(`${companyId}:${domain}`, pending);
  try { return await pending; } finally { refreshes.delete(`${companyId}:${domain}`); }
}
export async function disconnect(companyId: string, domain?: string) {
  const targets = domain ? [domain] : [...sites];
  for (const site of targets) {
    if (await setting(companyId, leaseKey(site))) throw new ApiError(409, "Synchronization is running; disconnect after it completes");
    await prisma.companySetting.deleteMany({ where: { companyId, key: connectionKey(site) } });
    const legacy = await setting(companyId, CONNECTION);
    if (legacy) {
      const c = legacy.value as unknown as Connection, remaining = c.sites.filter(s => s.domain !== site);
      if (remaining.length) await put(companyId, CONNECTION, { ...c, sites: remaining });
      else await prisma.companySetting.deleteMany({ where: { id: legacy.id } });
    }
  }
}
export async function sync(companyId: string, requested?: { start: string; end: string }, domain?: string) {
  if (!domain) {
    let found = false;
    for (const website of sites) if (await connectionRow(companyId, website)) { found = true; await sync(companyId, requested, website); }
    if (!found) throw new ApiError(409, "Connect Google for a website first");
    return;
  }
  if (!sites.includes(domain as any)) throw new ApiError(400, "Unsupported website");
  if (requested) range(requested.start, requested.end);
  const lockKey = leaseKey(domain);
  await prisma.companySetting.deleteMany({ where: { companyId, key: lockKey, updatedAt: { lt: new Date(Date.now() - 15 * 60000) } } });
  let lease;
  try { lease = await prisma.companySetting.create({ data: { companyId, key: lockKey, value: {} } }); } catch (error: any) { if (error.code === "P2002") throw new ApiError(409, "AdSense synchronization is already running"); throw error; }
  try {
    const initial = await connection(companyId, domain);
    if (!(await setting(companyId, connectionKey(domain)))) await put(companyId, connectionKey(domain), { ...initial, sites: initial.sites.filter(site => site.domain === domain) });
    let token = await access(companyId, domain), available: Site[];
    try { available = (await discover(token)).filter(site => site.domain === domain); }
    catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 401) throw error;
      const current = await connection(companyId, domain); await put(companyId, connectionKey(domain), { ...current, expires: 0 });
      token = await access(companyId, domain); available = (await discover(token)).filter(site => site.domain === domain);
    }
    if (!available.length) throw new ApiError(403, `The connected Google account no longer has access to ${domain}`);
    for (const site of available) {
      const today = day(site.timeZone);
      if (requested && requested.end > today) throw new ApiError(400, "AdSense dates cannot be in the future");
      const recent = { start: offset(today, -29), end: today };
      const windows = requested && (requested.start < recent.start || requested.end > recent.end) ? [recent, requested] : [recent];
      const values = new Map<string, { date: string; pageViews: number }>();
      for (const window of windows) {
        const result = await google(token, `${site.account}/reports:generate`, reportQuery(site.siteId, window.start, window.end));
        for (const row of parseReport(result, window.start, window.end)) values.set(row.date, row);
      }
      const rows = [...values.values()], stamp = new Date().toISOString();
      await prisma.$transaction(async tx => {
        const latest = await tx.companySetting.findUnique({ where: { companyId_key: { companyId, key: connectionKey(domain) } } });
        if ((latest?.value as any)?.generation !== initial.generation) throw new ApiError(409, "AdSense connection changed during synchronization");
        for (const row of rows) {
          const key = `adsense_day:${digest(site.account).slice(0, 24)}:${site.domain}:${row.date}`, value = { ...row, syncedAt: stamp };
          await tx.companySetting.upsert({ where: { companyId_key: { companyId, key } }, create: { companyId, key, value }, update: { value } });
        }
        const current = latest!.value as any;
        const updated = available.map(s => ({ ...s, lastSyncAt: s.domain === site.domain ? stamp : current.sites.find((old: Site) => old.domain === s.domain && old.account === s.account)?.lastSyncAt }));
        await tx.companySetting.update({ where: { id: latest!.id }, data: { value: JSON.parse(JSON.stringify({ ...current, sites: updated, error: undefined, lastAttempt: Date.now() })) } });
      }, { timeout: 30000 });
    }
  } catch (error) {
    const row = await setting(companyId, connectionKey(domain));
    if (row) { const c = row.value as any; await put(companyId, connectionKey(domain), { ...c, lastAttempt: Date.now(), error: error instanceof ApiError ? error.message : "AdSense sync failed; previous successful values retained", status: error instanceof ApiError && error.statusCode === 401 ? "RECONNECT_REQUIRED" : c.status }); }
    throw error;
  } finally { await prisma.companySetting.deleteMany({ where: { id: lease.id } }); }
}
/** Explicit report readers may use the shared Data Entry website reports;
 * credentials and account management remain scoped to the owning company. */
export async function sharedReportCompany(companyId: string, domain: string) {
  if (await connectionRow(companyId, domain)) return companyId;
  const rows = await prisma.companySetting.findMany({
    where: { key: { in: [CONNECTION, connectionKey(domain)] } },
    select: { companyId: true, value: true }
  });
  const owners = [...new Set(rows.filter(row =>
    (row.value as unknown as Connection).sites?.some(site => site.domain === domain)
  ).map(row => row.companyId))];
  // Never pick an arbitrary account when several separate company reports exist.
  return owners.length === 1 ? owners[0] : companyId;
}
export async function report(companyId: string, domain: string, requested?: { start: string; end: string }) {
  const row = await connectionRow(companyId, domain), c = row?.value as unknown as Connection | undefined;
  const site = c?.sites.find(site => site.domain === domain), today = day(site?.timeZone || "Asia/Kolkata"), yesterday = offset(today, -1);
  const start = requested?.start || offset(today, -29), end = requested?.end || today; range(start, end);
  if (end > today) throw new ApiError(400, "Choose dates up to today in the account reporting timezone");
  const dates = new Set([today, yesterday]); for (let d = start; d <= end; d = offset(d, 1)) dates.add(d);
  const keys = site ? [...dates].map(date => `adsense_day:${digest(site.account).slice(0, 24)}:${domain}:${date}`) : [];
  const rows = keys.length ? await prisma.companySetting.findMany({ where: { companyId, key: { in: keys } }, select: { value: true } }) : [];
  const data = new Map(rows.map(row => { const v = row.value as any; return [v.date, v.pageViews as number]; }));
  const connections = await Promise.all(sites.map(site => connectionRow(companyId, site)));
  return { connected: !!c, configured: configured(), status: c?.status, error: c?.error, websites: sites.map((domain, index) => ({ domain, available: !!connections[index] })), website: domain, timeZone: site?.timeZone, today, todayViews: data.get(today) ?? null, yesterdayViews: data.get(yesterday) ?? null, lastSyncAt: site?.lastSyncAt || null, rows: [...dates].filter(date => date >= start && date <= end).sort().map(date => ({ date, pageViews: data.get(date) ?? null, incomplete: date === today })) };
}
export function startAdSenseJobs() {
  if (process.env.ADSENSE_JOBS_ENABLED === "false") return;
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      const connections = await prisma.companySetting.findMany({ where: { key: { in: [CONNECTION, ...sites.map(connectionKey)] } } });
      const seen = new Set<string>();
      for (const row of connections) {
        for (const site of (row.value as unknown as Connection).sites) {
        const identity = `${row.companyId}:${site.domain}`;
        if (seen.has(identity)) continue; seen.add(identity);
        const c = await connection(row.companyId, site.domain);
        const lastSync = c.sites.find(connected => connected.domain === site.domain)?.lastSyncAt;
        const lastActivity = Math.max(c.lastAttempt || 0, lastSync ? Date.parse(lastSync) : 0);
        if (c.status !== "CONNECTED" || Date.now() - lastActivity < 30 * 60000) continue;
        try { await sync(row.companyId, undefined, site.domain); } catch { console.error("AdSense scheduled synchronization failed", row.companyId); }
        }
      }
    } catch { console.error("AdSense scheduler unavailable"); } finally { running = false; }
  };
  const first = setTimeout(() => void tick(), 15000); first.unref(); const timer = setInterval(() => void tick(), 60000); timer.unref();
}
