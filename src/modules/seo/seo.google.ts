import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import type { AuthUser } from "../../middleware/auth.js";
import { admin, company } from "./seo.access.js";
import { hash, seal, unseal } from "./seo.domain.js";
const base = "https://www.googleapis.com/webmasters/v3";
function config() {
  const {
    SEO_GOOGLE_CLIENT_ID: clientId,
    SEO_GOOGLE_CLIENT_SECRET: clientSecret,
    SEO_GOOGLE_REDIRECT_URI: redirectUri,
  } = process.env;
  if (!clientId || !clientSecret || !redirectUri)
    throw new ApiError(503, "Google Search Console OAuth is not configured");
  return { clientId, clientSecret, redirectUri };
}
async function tokenRequest(body: Record<string, string>) {
  const c = config();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      ...body,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const error = (await r.json().catch(() => ({}))) as { error?: string };
    if (error.error === "invalid_grant")
      throw new ApiError(
        401,
        "Google authorization expired or was revoked; reconnect",
      );
    throw new ApiError(
      502,
      `Google authorization failed (${r.status}); reconnect if access was revoked`,
    );
  }
  return (await r.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}
export async function begin(u: AuthUser) {
  if (!admin(u)) throw new ApiError(403, "Administrator required");
  const c = config(),
    verifier = randomBytes(32).toString("base64url"),
    state = randomBytes(32).toString("base64url");
  await prisma.seoOAuthState.create({
    data: {
      id: hash(state),
      userId: u.id,
      companyId: company(u),
      verifierCipher: seal(verifier),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  const challenge = Buffer.from(hash(verifier), "hex").toString("base64url");
  url.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString() };
}
export async function callback(state: string, code: string) {
  const saved = await prisma.seoOAuthState.findUnique({
    where: { id: hash(state) },
  });
  if (!saved || saved.expiresAt < new Date())
    throw new ApiError(400, "OAuth session expired");
  const consumed = await prisma.seoOAuthState.deleteMany({
    where: { id: saved.id },
  });
  if (consumed.count !== 1)
    throw new ApiError(400, "OAuth session already used");
  const user = await prisma.user.findFirst({
    where: { id: saved.userId, companyId: saved.companyId, isActive: true },
  });
  if (!user || !admin(user as AuthUser))
    throw new ApiError(403, "Administrator access revoked");
  const result = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: config().redirectUri,
    code_verifier: unseal(saved.verifierCipher),
  });
  if (!result.refresh_token)
    throw new ApiError(
      400,
      "Google did not grant offline access; reconnect with consent",
    );
  const connection = await prisma.seoConnection.create({
    data: {
      companyId: saved.companyId,
      ownerUserId: saved.userId,
      accessCipher: seal(result.access_token),
      refreshCipher: seal(result.refresh_token),
      expiresAt: new Date(Date.now() + result.expires_in * 1000),
    },
  });
  await discover(connection.id);
}
const refreshes = new Map<string, Promise<string>>();
async function access(connectionId: string): Promise<string> {
  const c = await prisma.seoConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  if (c.status !== "CONNECTED")
    throw new ApiError(409, "Google connection disconnected");
  if (+c.expiresAt > Date.now() + 60000) return unseal(c.accessCipher);
  if (refreshes.has(c.id)) return refreshes.get(c.id)!;
  const pending = (async () => {
    const token = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: unseal(c.refreshCipher),
    });
    await prisma.seoConnection.update({
      where: { id: c.id },
      data: {
        accessCipher: seal(token.access_token),
        ...(token.refresh_token
          ? { refreshCipher: seal(token.refresh_token) }
          : {}),
        expiresAt: new Date(Date.now() + token.expires_in * 1000),
      },
    });
    return token.access_token;
  })();
  refreshes.set(c.id, pending);
  try {
    return await pending;
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401)
      await prisma.seoConnection.update({
        where: { id: c.id },
        data: { status: "RECONNECT_REQUIRED" },
      });
    throw error;
  } finally {
    refreshes.delete(c.id);
  }
}
export async function google(
  connectionId: string,
  path: string,
  body?: unknown,
  inspection = false,
): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await access(connectionId);
    const r = await fetch(
      inspection
        ? "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
        : `${base}${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25000),
      },
    );
    if (r.ok) return r.json();
    if (r.status === 401 && attempt === 0) {
      await prisma.seoConnection.update({
        where: { id: connectionId },
        data: { expiresAt: new Date(0) },
      });
      continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new ApiError(
      502,
      `Search Console request failed (${r.status}); access, quota or Google availability may require attention`,
    );
  }
}
export async function discover(connectionId: string) {
  const result = await google(connectionId, "/sites");
  for (const site of result.siteEntry || [])
    await prisma.seoProperty.upsert({
      where: { connectionId_siteUrl: { connectionId, siteUrl: site.siteUrl } },
      create: {
        connectionId,
        siteUrl: site.siteUrl,
        permissionLevel: site.permissionLevel,
      },
      update: { permissionLevel: site.permissionLevel },
    });
  return result;
}
export async function disconnect(u: AuthUser, id: string) {
  if (!admin(u)) throw new ApiError(403, "Administrator required");
  const c = await prisma.seoConnection.findFirst({
    where: { id, companyId: company(u) },
  });
  if (!c) throw new ApiError(404, "Connection not found");
  // Revocation can affect other grants on the Google account: disconnect locally,
  // clear secrets and retain historic metrics and client mappings for audit.
  await prisma.seoConnection.update({
    where: { id },
    data: { status: "DISCONNECTED", accessCipher: "", refreshCipher: "" },
  });
}
