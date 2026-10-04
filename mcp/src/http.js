import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { createOAuthProvider } from './oauth.js';

export function createHttpRouter({ issuerUrl, baseUrl, store, authenticate, validateUser, getBackendToken }) {
  const router = express.Router();
  const issuer = new URL(issuerUrl);
  const resource = new URL('/mcp', issuer);
  const provider = createOAuthProvider({ store, issuerUrl, authenticate, validateUser });
  router.use(mcpAuthRouter({ provider, issuerUrl: issuer, resourceServerUrl: resource, scopesSupported: ['stems:read'], resourceName: 'Stems Employee Performance' }));
  router.post('/mcp/login', rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }), express.urlencoded({ extended: false, limit: '8kb' }), (req, res) => provider.login(req, res));
  router.get('/mcp/info', (_req, res) => res.json({ name: 'Stems Employee Performance', version: '1.0.0', transport: 'streamable-http', endpoint: resource.href, authentication: 'oauth2', scope: 'stems:read' }));
  const auth = requireBearerAuth({ verifier: provider, requiredScopes: ['stems:read'], resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', issuer).href, expectedResource: resource });
  router.post('/mcp', auth, express.json({ limit: '256kb' }), async (req, res) => {
    let server;
    let transport;
    try {
      const token = await getBackendToken(req.auth.extra.userId);
      server = createServer({ baseUrl, token, oauth: true });
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      await transport?.close();
      await server?.close();
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Unable to process Stems MCP request.' }, id: null });
    }
  });
  router.all('/mcp', auth, (_req, res) => res.status(405).set('Allow', 'POST').end());
  return router;
}
