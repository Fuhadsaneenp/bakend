# Stems Employee Performance MCP

Production endpoint after deployment: https://api.secondtales.com/mcp

Read-only tools: health, employees, notifications, employee performance by month.
Employee reports include attendance punches, task status histories, rework/points,
and dated data-entry activity with separate undated snapshots. Status changes are
timing proxies, not active work timers. Task start/end timers and intermediate
biometric punches are not currently captured by this adapter.

The HTTP endpoint requires OAuth authorization-code + S256 PKCE. Connect it as a
personal OAuth plugin in ChatGPT developer mode, install it, then use @Stems in
Work. Sign in with an active Stems HR/admin/manager account with company context.
Authorization does not reset passwords or invalidate the existing Stems session.

Protected resource metadata: /.well-known/oauth-protected-resource/mcp
Authorization server metadata: /.well-known/oauth-authorization-server
Public service information: /mcp/info

By default MCP_PUBLIC_URL is https://api.secondtales.com. Internal API requests
use loopback and the configured backend port. Existing role and company checks
apply. Opaque OAuth tokens are hashed before database lookup; authorization flows,
registered clients, and hashes are durable in CompanySetting. No migration needed.
Refresh tokens rotate, access tokens expire after one hour, and each request
checks that the Stems account is still active. Registered redirect URIs are limited
to ChatGPT OAuth callback paths. GET /mcp is intentionally 405; MCP uses POST.

Validation: backend Prisma generation and TypeScript compilation; 11 adapter tests
cover discovery, company boundaries, report attribution and deduplication, OAuth
CSRF, PKCE, resource audience, single-use codes, and refresh rotation.

To run adapter tests locally: npm install --prefix mcp --workspaces=false;
npm test --prefix mcp. Tests start a loopback HTTP listener.
