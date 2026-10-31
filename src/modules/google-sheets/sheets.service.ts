import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { hash, seal, unseal } from "../seo/seo.domain.js";
const KEY = "google_sheets_connection_v1";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export type Connection = {
  syncEnabled?: boolean;
  lastSyncAt?: string;
  syncError?: string;
  ownerId: string;
  accessCipher: string;
  refreshCipher: string;
  expiresAt: number;
  spreadsheetId?: string;
  title?: string;
  worksheetId?: number;
  worksheetTitle?: string;
  direction?: "two-way" | "import" | "export";
};
export function authorize(u: AuthUser) {
  if (!["SUPER_ADMIN", "HR_ADMIN"].includes(u.role) || u.impersonatedBy)
    throw new ApiError(
      403,
      "A signed-in administrator must manage Google Sheets",
    );
  if (!u.companyId) throw new ApiError(400, "Company context required");
  return u.companyId;
}
function config() {
  const clientId =
      process.env.SHEETS_GOOGLE_CLIENT_ID || process.env.SEO_GOOGLE_CLIENT_ID,
    clientSecret =
      process.env.SHEETS_GOOGLE_CLIENT_SECRET ||
      process.env.SEO_GOOGLE_CLIENT_SECRET,
    redirectUri =
      process.env.SHEETS_GOOGLE_REDIRECT_URI ||
      process.env.SEO_GOOGLE_REDIRECT_URI;
  if (
    !clientId ||
    !clientSecret ||
    !redirectUri ||
    !/^[a-f0-9]{64}$/i.test(process.env.SEO_TOKEN_KEY || "")
  )
    throw new ApiError(
      503,
      "Google Sheets needs server-side Google OAuth setup",
    );
  return { clientId, clientSecret, redirectUri };
}
export async function read(companyId: string) {
  const record = await prisma.companySetting.findUnique({
    where: { companyId_key: { companyId, key: KEY } },
  });
  return record?.value as Connection | null;
}
export async function write(companyId: string, value: Connection) {
  await prisma.companySetting.upsert({
    where: { companyId_key: { companyId, key: KEY } },
    create: { companyId, key: KEY, value },
    update: { value },
  });
}
export async function status(u: AuthUser) {
  const companyId = authorize(u);
  let configured = true;
  try {
    config();
  } catch {
    configured = false;
  }
  const saved = await read(companyId);
  return {
    configured,
    connected: !!saved,
    spreadsheetId: saved?.spreadsheetId,
    title: saved?.title,
    worksheetId: saved?.worksheetId,
    worksheetTitle: saved?.worksheetTitle,
    direction: saved?.direction || "two-way",
    syncEnabled: saved?.syncEnabled === true,
    lastSyncAt: saved?.lastSyncAt,
    syncError: saved?.syncError,
    redirectUri:
      process.env.SHEETS_GOOGLE_REDIRECT_URI ||
      process.env.SEO_GOOGLE_REDIRECT_URI ||
      "https://api.secondtales.com/api/seo/google/callback",
  };
}
export async function begin(u: AuthUser) {
  const companyId = authorize(u),
    c = config(),
    state = "sheets." + randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  await prisma.companySetting.create({
    data: {
      companyId,
      key: "google_sheets_oauth_" + hash(state),
      value: {
        userId: u.id,
        verifierCipher: seal(verifier),
        expiresAt: Date.now() + 600000,
      },
    },
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: Buffer.from(hash(verifier), "hex").toString("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString() };
}
async function exchange(body: Record<string, string>) {
  const c = config();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      ...body,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new ApiError(
      502,
      "Google authorization failed. Connect Google again.",
    );
  const token = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  if (!token.access_token || !token.expires_in)
    throw new ApiError(502, "Google returned an incomplete authorization");
  return token;
}
export async function callback(state: string, code: string) {
  if (!state.startsWith("sheets."))
    throw new ApiError(400, "Invalid Google Sheets authorization");
  const key = "google_sheets_oauth_" + hash(state);
  const record = await prisma.companySetting.findFirst({ where: { key } });
  const saved = record?.value as
    | { userId: string; verifierCipher: string; expiresAt: number }
    | undefined;
  if (!record || !saved || saved.expiresAt < Date.now())
    throw new ApiError(
      400,
      "Google authorization expired. Try connecting again.",
    );
  const consumed = await prisma.companySetting.deleteMany({
    where: { id: record.id },
  });
  if (consumed.count !== 1)
    throw new ApiError(400, "Authorization already used");
  const user = await prisma.user.findUnique({ where: { id: saved.userId } });
  if (!user || !user.isActive || user.companyId !== record.companyId)
    throw new ApiError(403, "Account access changed");
  authorize(user as AuthUser);
  const token = await exchange({
    code,
    grant_type: "authorization_code",
    redirect_uri: config().redirectUri,
    code_verifier: unseal(saved.verifierCipher),
  });
  if (!token.refresh_token || !token.scope?.split(" ").includes(SCOPE))
    throw new ApiError(
      400,
      "Google Sheets permission and offline access are required",
    );
  const existing = await read(record.companyId);
  await write(record.companyId, {
    ...existing,
    ownerId: saved.userId,
    accessCipher: seal(token.access_token),
    refreshCipher: seal(token.refresh_token),
    expiresAt: Date.now() + token.expires_in * 1000,
  });
}
const refreshing = new Map<string, Promise<string>>();
async function access(companyId: string) {
  const saved = await read(companyId);
  if (!saved) throw new ApiError(409, "Connect Google first");
  if (saved.expiresAt > Date.now() + 60000) return unseal(saved.accessCipher);
  const pending = refreshing.get(companyId);
  if (pending) return pending;
  const request = (async () => {
    const token = await exchange({
      grant_type: "refresh_token",
      refresh_token: unseal(saved.refreshCipher),
    });
    const current = await read(companyId);
    if (!current || current.refreshCipher !== saved.refreshCipher)
      throw new ApiError(409, "Google connection changed. Try again.");
    await write(companyId, {
      ...current,
      accessCipher: seal(token.access_token),
      refreshCipher: token.refresh_token
        ? seal(token.refresh_token)
        : saved.refreshCipher,
      expiresAt: Date.now() + token.expires_in * 1000,
    });
    return token.access_token;
  })();
  refreshing.set(companyId, request);
  try {
    return await request;
  } finally {
    refreshing.delete(companyId);
  }
}
export function spreadsheetId(input: string) {
  const raw = input.trim();
  if (/^[A-Za-z0-9_-]{20,200}$/.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(
      400,
      "Paste a valid Google Sheets link or spreadsheet ID",
    );
  }
  const id = url.pathname.match(
    /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})(?:\/|$)/,
  )?.[1];
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !id)
    throw new ApiError(400, "Use a docs.google.com spreadsheet link");
  return id;
}
export async function google(companyId: string, path: string, init?: RequestInit) {
  const token = await access(companyId);
  const response = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + path,
    {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok)
    throw new ApiError(
      response.status === 403 ? 403 : 502,
      response.status === 403
        ? "Google Sheets access denied. Enable the Sheets API and check your spreadsheet permissions."
        : "Could not read the Google Sheet. Check the link and connection.",
    );
  return response.json();
}
export async function inspect(u: AuthUser, input: string) {
  const companyId = authorize(u),
    id = spreadsheetId(input);
  const data = (await google(
    companyId,
    id +
      "?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties))",
  )) as any;
  return {
    spreadsheetId: id,
    title: data.properties?.title,
    worksheets: (data.sheets || []).map((sheet: any) => ({
      id: sheet.properties.sheetId,
      title: sheet.properties.title,
    })),
  };
}
export async function select(
  u: AuthUser,
  input: string,
  worksheetId: number,
  direction: Connection["direction"],
) {
  const companyId = authorize(u),
    metadata = await inspect(u, input),
    worksheet = metadata.worksheets.find(
      (sheet: any) => sheet.id === worksheetId,
    );
  if (!worksheet)
    throw new ApiError(400, "Choose a worksheet from this spreadsheet");
  const connection = await read(companyId);
  if (!connection) throw new ApiError(409, "Connect Google first");
  await write(companyId, {
    ...connection,
    spreadsheetId: metadata.spreadsheetId,
    title: metadata.title,
    worksheetId,
    worksheetTitle: worksheet.title,
    direction,
    syncEnabled: false,
  });
  return status(u);
}
export async function disconnect(u: AuthUser) {
  const companyId = authorize(u);
  await prisma.companySetting.deleteMany({ where: { companyId, key: KEY } });
  return { connected: false };
}
export function destination(result: string) {
  const url = new URL(
    "/work-track",
    process.env.APP_ORIGIN || "https://stems.secondtales.com",
  );
  url.search = new URLSearchParams({
    track: "data-entry",
    tab: "company-master-sheet",
    sheets: result,
  }).toString();
  return url.toString();
}
