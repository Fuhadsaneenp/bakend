import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import { createHttpRouter } from '../src/http.js';

test('OAuth uses consent, CSRF, S256 PKCE, audience binding, single-use codes, and refresh rotation', async () => {
  const records = new Map();
  const store = { async get(key) { return records.get(key); }, async set(key, value) { records.set(key, value); },
    async take(key) { return records.delete(key); }, async delete(key) { records.delete(key); } };
  const app = express();
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;
  app.use(createHttpRouter({ issuerUrl: base, baseUrl: base, store,
    authenticate: async (email, password) => { assert.equal(email, 'hr@test.invalid'); assert.equal(password, 'test-only'); return { id: 'user' }; },
    validateUser: async id => { assert.equal(id, 'user'); return { id }; }, getBackendToken: async () => 'internal-test-token' }));
  const form = body => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), redirect: 'manual' });
  try {
    const metadata = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    assert.equal(metadata.resource, `${base}/mcp`);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST' })).status, 401);
    const evil = await fetch(`${base}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.invalid/callback'], token_endpoint_auth_method: 'none' }) });
    assert.equal(evil.status, 400);
    const callback = 'https://chatgpt.com/connector/oauth/test';
    const client = await (await fetch(`${base}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [callback], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }) })).json();
    assert.ok(client.client_id);
    const verifier = 'test-verifier-with-more-than-forty-three-characters';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'stems:read', resource: `${base}/mcp`, state: 'state' });
    const authorization = await fetch(`${base}/authorize?${query}`);
    assert.equal(authorization.status, 200);
    const html = await authorization.text();
    const flow = html.match(/name="flow" value="([^"]+)"/)[1];
    const csrf = html.match(/name="csrf" value="([^"]+)"/)[1];
    const login = form({ flow, csrf, email: 'hr@test.invalid', password: 'test-only' });
    assert.equal((await fetch(`${base}/mcp/login`, login)).status, 403);
    login.headers.Cookie = authorization.headers.get('set-cookie').split(';')[0];
    const consent = await fetch(`${base}/mcp/login`, login);
    assert.equal(consent.status, 302);
    const location = new URL(consent.headers.get('location'));
    assert.equal(location.searchParams.get('state'), 'state');
    const grant = { grant_type: 'authorization_code', client_id: client.client_id, code: location.searchParams.get('code'), code_verifier: verifier, redirect_uri: callback, resource: `${base}/mcp` };
    assert.equal((await fetch(`${base}/token`, form({ ...grant, code_verifier: 'wrong' }))).status, 400);
    assert.equal((await fetch(`${base}/token`, form({ ...grant, resource: 'https://evil.invalid' }))).status, 400);
    const issued = await fetch(`${base}/token`, form(grant));
    assert.equal(issued.status, 200);
    const tokens = await issued.json();
    assert.ok(tokens.access_token);
    assert.equal((await fetch(`${base}/token`, form(grant))).status, 400);
    const initialize = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
    assert.equal(initialize.status, 200);
    assert.equal((await initialize.json()).result.serverInfo.name, 'stems');
    const refresh = { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: `${base}/mcp` };
    assert.equal((await fetch(`${base}/token`, form(refresh))).status, 200);
    assert.equal((await fetch(`${base}/token`, form(refresh))).status, 400);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}` } })).status, 401);
  } finally { await new Promise(resolve => listener.close(resolve)); }
});
