import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

const scope = 'stems:read';
const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// The SDK handles OAuth parameter validation, client authentication, and S256 PKCE.
// Storage is supplied by the backend and must implement atomic, single-use take().
export function createOAuthProvider({ store, issuerUrl, authenticate, validateUser }) {
  const resource = new URL('/mcp', issuerUrl).href;
  const issuer = new URL(issuerUrl).href;
  function checkResource(value) {
    if (!value || value.href !== resource) throw new InvalidGrantError('Resource must match the Stems MCP endpoint.');
  }
  function checkScopes(scopes = [scope]) {
    if (scopes.length !== 1 || scopes[0] !== scope) throw new InvalidScopeError('Only stems:read is supported.');
  }
  async function read(key) {
    const record = await store.get(key);
    if (!record || record.expiresAt <= Date.now()) throw new InvalidGrantError('Authorization expired. Please reconnect Stems.');
    return record;
  }
  async function issue(clientId, userId) {
    await validateUser(userId);
    const accessToken = random();
    const refreshToken = random();
    const accessKey = `access:${hash(accessToken)}`;
    await store.set(accessKey, { clientId, userId, expiresAt: Date.now() + 3600_000, resource, scopes: [scope] });
    await store.set(`refresh:${hash(refreshToken)}`, { clientId, userId, accessKey, expiresAt: Date.now() + 30 * 86400_000, resource, scopes: [scope] });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken, scope };
  }
  const provider = {
    clientsStore: {
      async getClient(id) { return store.get(`client:${hash(id)}`); },
      async registerClient(client) {
        if (!client.redirect_uris?.length || client.redirect_uris.length > 5 || client.redirect_uris.some(uri => {
          const url = new URL(uri);
          return url.username || url.password || url.hash ||
            !(url.protocol === 'https:' && url.hostname === 'chatgpt.com' &&
              (url.pathname.startsWith('/connector/oauth/') || url.pathname === '/connector_platform_oauth_redirect'));
        })) throw new InvalidClientMetadataError('Only ChatGPT OAuth callback URLs are accepted.');
        if (client.grant_types?.some(grant => !['authorization_code', 'refresh_token'].includes(grant))) throw new InvalidClientMetadataError('Unsupported grant.');
        await store.set(`client:${hash(client.client_id)}`, client);
        return client;
      },
    },
    async authorize(client, params, res) {
      checkResource(params.resource);
      checkScopes(params.scopes?.length ? params.scopes : [scope]);
      const flow = random();
      const csrf = random();
      await store.set(`flow:${hash(flow)}`, {
        clientId: client.client_id, clientName: client.client_name || 'ChatGPT', csrf,
        redirectUri: params.redirectUri, state: params.state, codeChallenge: params.codeChallenge,
        expiresAt: Date.now() + 600_000,
      });
      res.cookie('stems_mcp_csrf', csrf, { httpOnly: true, secure: new URL(issuer).protocol === 'https:', sameSite: 'lax', path: '/mcp/login', maxAge: 600_000 });
      res.setHeader('Cache-Control', 'no-store');
      // Preserve the same-origin POST Origin while hiding referrers on the ChatGPT redirect.
      res.setHeader('Referrer-Policy', 'same-origin');
      res.type('html').send(loginPage(flow, csrf, client.client_name || 'ChatGPT'));
    },
    async challengeForAuthorizationCode(client, code) {
      const record = await read(`code:${hash(code)}`);
      if (record.clientId !== client.client_id) throw new InvalidGrantError('Invalid authorization code.');
      return record.codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, requestedResource) {
      checkResource(requestedResource);
      const key = `code:${hash(code)}`;
      const record = await read(key);
      if (record.clientId !== client.client_id || record.redirectUri !== redirectUri) throw new InvalidGrantError('Invalid authorization code.');
      if (!await store.take(key)) throw new InvalidGrantError('Authorization code has already been used.');
      return issue(client.client_id, record.userId);
    },
    async exchangeRefreshToken(client, token, scopes, requestedResource) {
      checkResource(requestedResource);
      checkScopes(scopes || [scope]);
      const key = `refresh:${hash(token)}`;
      const record = await read(key);
      if (record.clientId !== client.client_id) throw new InvalidGrantError('Invalid refresh token.');
      await validateUser(record.userId);
      if (!await store.take(key)) throw new InvalidGrantError('Refresh token has already been used.');
      await store.delete(record.accessKey);
      return issue(client.client_id, record.userId);
    },
    async verifyAccessToken(token) {
      try {
        const record = await read(`access:${hash(token)}`);
        await validateUser(record.userId);
        return { token, clientId: record.clientId, scopes: record.scopes, expiresAt: Math.floor(record.expiresAt / 1000), resource: new URL(record.resource), extra: { userId: record.userId } };
      } catch { throw new InvalidTokenError('Invalid or expired Stems authorization.'); }
    },
    async revokeToken(client, request) {
      for (const kind of ['access', 'refresh']) {
        const key = `${kind}:${hash(request.token)}`;
        const record = await store.get(key);
        if (record?.clientId === client.client_id) {
          await store.delete(key);
          if (record.accessKey) await store.delete(record.accessKey);
        }
      }
    },
    async login(req, res) {
      res.setHeader('Cache-Control', 'no-store');
      // Preserve the same-origin POST Origin while hiding referrers on the ChatGPT redirect.
      res.setHeader('Referrer-Policy', 'same-origin');
      const flow = String(req.body?.flow || '');
      try {
        const record = await read(`flow:${hash(flow)}`);
        const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('stems_mcp_csrf='))?.slice('stems_mcp_csrf='.length);
        if (!equal(record.csrf, req.body?.csrf) || !equal(record.csrf, cookie)) return res.status(403).send('Sign-in session invalid. Start the connection again.');
        if (req.headers.origin && req.headers.origin !== new URL(issuer).origin) return res.status(403).send('Invalid sign-in origin.');
        let user;
        try {
          user = await authenticate(String(req.body?.email || '').slice(0, 254), String(req.body?.password || '').slice(0, 1024));
          await validateUser(user.id);
        } catch {
          return res.status(401).type('html').send(loginPage(flow, record.csrf, record.clientName, 'Unable to sign in. Check your Stems email/password and reporting permissions.'));
        }
        if (!await store.take(`flow:${hash(flow)}`)) return res.status(400).send('This connection request has already been used.');
        const code = random();
        await store.set(`code:${hash(code)}`, { ...record, userId: user.id, expiresAt: Date.now() + 120_000 });
        const redirect = new URL(record.redirectUri);
        redirect.searchParams.set('code', code);
        if (record.state) redirect.searchParams.set('state', record.state);
        redirect.searchParams.set('iss', issuer);
        res.clearCookie('stems_mcp_csrf', { path: '/mcp/login', secure: new URL(issuer).protocol === 'https:', sameSite: 'lax' });
        return res.redirect(redirect.href);
      } catch { return res.status(400).send('Connection expired. Please start again from ChatGPT.'); }
    },
  };
  return provider;
}

function loginPage(flow, csrf, clientName, error = '') {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Stems</title>
  <style>body{font:16px system-ui;background:#f5f6f8;color:#17202c;margin:0;padding:24px}main{max-width:420px;margin:8vh auto;background:white;padding:32px;border-radius:20px;box-shadow:0 10px 40px #17202c12}h1{font-size:26px}label{display:block;margin-top:20px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:8px;border-radius:8px;border:1px solid #ccd1da;font:inherit}button{background:#17202c;color:white;margin-top:24px;cursor:pointer}.error{color:#b42318}small{color:#566274}</style>
  <main><h1>Connect Stems to ${escape(clientName)}</h1><p>Allow read-only access to employee attendance, work cards, and data-entry reports using your Stems account permissions.</p>
  ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ''}
  <form method="post" action="/mcp/login"><input type="hidden" name="flow" value="${escape(flow)}"><input type="hidden" name="csrf" value="${escape(csrf)}">
  <label>Email or employee code<input name="email" autocomplete="username" required maxlength="254"></label><label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label>
  <button type="submit">Sign in and allow read-only access</button></form><p><small>For HR administrators and managers. Your password stays with Stems and is not shared with ChatGPT. You can disconnect the integration from ChatGPT.</small></p></main></html>`;
}
