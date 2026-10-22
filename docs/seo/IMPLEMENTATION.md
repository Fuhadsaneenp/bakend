# Integrated SEO workspace — implementation and rollout

## Current localhost connection — October 22, 2026

At the user’s request, the SEO changes were reconciled with the latest GitHub main revisions: backend `63da758` (37 commits newer than the initial audit) and frontend `b10ca46` (55 commits newer). This retains the current Data Entry, HR/KPI, job monitoring, attendance, and AI/voice updates.

Localhost now uses the existing hosted STEMS MySQL database, matching the previous local development setup. The ignored backend `.env` reuses the previously configured credentials and signing keys; no credentials are committed. Use existing STEMS accounts; the temporary `admin@stems.local` account belonged only to the separate empty local database.

The 32 statements in the additive SEO migration were applied directly after saving a read-only schema snapshot under ignored `backend/tmp/`. Existing table counts remained unchanged before/after: 38 clients, 28 employees, 489 work cards. No existing clients, employees, passwords, work cards, or points were rewritten. No clients were automatically declared to have SEO services. Real permitted clients are available in the SEO client selector; selecting an unconfigured client enables its workspace.

Local changes now save to the live database. The SEO screen displays that connection status. SEO synchronization jobs and the new portal collection worker are disabled for local startup; existing schema-repair startup routines can be skipped with `LOCAL_SCHEMA_AUTOMATION_DISABLED=true`. The hosted frontend/backend deployment was not replaced. Browser-local legacy keyword sheets remain browser-specific until imported. The live site was reachable at its login page; authenticated live-screen comparison requires the user’s existing login.

After reconciliation, both production builds and type checks passed; 32 backend regression tests and the current Data Entry regression passed. One stale verified-analytics test fixture was updated with the client object now returned by its query.


## Audit before implementation

The parent repository records backend `6ec73c1` and frontend `daaa547` as nested repositories. They were empty in the task checkout; isolated Git worktrees were created from those exact revisions on `codex/seo-management`. The original working copies were left alone. Older ZIP archives and the August baseline document were not used as application source.

Existing foundations reused:

- Express/TypeScript modular backend, Prisma 7 and **MySQL/MariaDB**. The README's PostgreSQL description is out of date for the current Prisma schema.
- `Client` for existing customers; `Employee` and `User` for identities; JWT `requireAuth` for current account status.
- Authority permission resolver and scopes; existing `seo.ranking.*`, `seo.backlink.*`, `seo.report.view`, and `worktrack.*` grants.
- `WorkCard`, status history and `PointsLedger` for verified SEO work and existing performance summaries.
- Existing `geminiClient` for AI, existing frontend API/session handling, Recharts and the current Work Track shell.

The old SEO keyword/backlink sheets were browser-local (`seo_ranking_sheets_storage_v2`, `seo_backlink_sheets_storage_v2`). They were not centrally stored or available for an automatic server migration. The old overview included fabricated fallback counts and a live-sync label. The upgraded overview uses actual database records or an explicit unavailable state. Old sheets remain accessible; an administrator can import each client's browser-local sheet and specify its actual reporting month. Raw rows are archived before conversion, including rows with incomplete URLs. Valid monthly manual ranks use `LEGACY_MONTHLY_MANUAL`; imported backlinks are unverified and unattributed. Local storage is never cleared.

## Implemented boundaries

- Twelve workspace sections inside the existing SEO Work Track branch, with responsive scoped CSS. Existing sidebar, authentication, layout and other department components are retained.
- OAuth authorization-code flow with state persisted as a SHA-256 digest, ten-minute expiry, single-use consumption and PKCE. Only `webmasters.readonly` is requested. AES-256-GCM encrypts backend token material. Credentials and encrypted token columns are excluded from API responses. A connection can discover multiple URL-prefix/domain properties and map them to different clients. Disconnect clears local credentials; it intentionally does not revoke the entire Google account grant, which could affect other client connections.
- Bounded Search Analytics paging: date totals and independent query/page/country/device breakdowns; up to 50,000 rows per dimension/job. Initial import covers 90 days; daily jobs refresh ten recent days. Privacy-filtered/top-row results are explicitly incomplete. Site totals are never reconstructed by summing query/page samples. CTR uses total clicks/impressions; period position is impression-weighted.
- Unique metric identities, database leases, fifteen-minute manual retry limits, one-hour failed-job retry scheduling, sync logs and exponential backoff for quota/server failures. Dashboard reads do not call Google. Changing an established property's URL is blocked to prevent blending unrelated histories.
- Keyword targets, CSV import/export (formula-prefix escaping), manual exact observations, GSC daily average history, legacy monthly manual history. Country/device-specific targets remain without GSC values when matching segmented data is unavailable; an all-country average is not assigned to them.
- Task assignment, evidence URLs, private PDF/image attachments, start/submit/reject/correct/approve states, independent review, quantity and quality fields, review history, configurable weights and a unique task credit. Points are written transactionally to the existing ledger only after review. An evidence fingerprint rejects identical approved evidence/category credits in the same client workspace. Rules apply prospectively. Ranking changes award no points.
- Backlink, on-page, technical and content records with version history and manager verification. HTTPS HTML verification pins public IPv4 DNS resolution, refuses redirects/private networks, bounds time/body size, parses actual anchors and extracts supported rel attributes. Missing/inaccessible/JS links remain inconclusive. Automatic detection is separate from manager approval and never awards points. No third-party domain authority is invented.
- AI answers from bounded selected-client or permitted multi-client snapshots, with explicit verified/interpretation/recommendation instructions and unavailable states. Monthly report snapshots, full-calendar previous-month comparison, top queries/pages, comparable keyword averages, verified work, pending issues, AI summary and PDF export.
- Opt-in background worker runs every ten minutes. Connected properties are due daily. After day five, it generates missing previous-month reports for workspaces that have synchronized data. Database leases protect property sync across instances; report upserts prevent duplicate monthly records.

Backend handlers require both company-scoped workspace lookup and explicit membership for non-admins, plus existing authority permission grants. Heads must have `HEAD` membership and review/assignment grants. Employees submit only their own tasks. Reviewers cannot approve their own work. The membership table references existing employees. Legacy Work Track card mutation/deletion/manual-points endpoints reject SEO-managed cards; legacy card lists exclude them. Other departments retain their existing logic.

The database adapter previously hard-coded its MySQL password and ignored `DATABASE_URL`. It now uses the configured URL password. Existing fallback URL behavior was not otherwise changed.

## Production configuration

Set these **only on the backend**, using the deployment's secret manager:

```
SEO_GOOGLE_CLIENT_ID=<Google OAuth web application client ID>
SEO_GOOGLE_CLIENT_SECRET=<Google OAuth client secret>
SEO_GOOGLE_REDIRECT_URI=https://api.secondtales.com/api/seo/google/callback
SEO_TOKEN_KEY=<64 hexadecimal characters generated from 32 random bytes>
SEO_JOBS_ENABLED=false
```

Also verify `DATABASE_URL`, `APP_ORIGIN=https://stems.secondtales.com`, existing JWT configuration and optionally `GEMINI_API_KEY`. No credentials are committed; the current ignored local environment reuses the existing connection as described above. Back up the encryption key separately; losing it requires reconnecting Google accounts. Key rotation currently requires reconnecting connections; no automatic key-ring rotation is implemented.

Enable the Google Search Console API in the Google Cloud project, configure the OAuth consent screen/test users or required verification, and register the exact backend callback URI. Properties must be accessible to the consenting Google account. URL Inspection shows Google's supported indexed URL state; it is not a website-wide crawler.

## Safe rollout

1. Back up production MySQL and preserve the nested repositories' current deployed commits. Record which migration baseline the live database actually uses. Do not run `db push` in production.
2. Review the additive migration at `backend/prisma/migrations/20261022160000_seo_management/migration.sql` against a production schema clone. It creates SEO tables, indexes and foreign keys; it does not rewrite existing client/keyword records.
3. Install dependencies and generate Prisma Client. Apply the migration with the deployment's established migration procedure. If the live schema is not baselined in Prisma migration history, resolve that separately before `prisma migrate deploy`; the repository's earlier migration history may not represent the whole existing database.
4. Deploy backend with jobs disabled. Deploy frontend from its nested checkout. Existing environment variables must be preserved. The parent Git repository stores nested commit references: commit/push backend and frontend changes in their own repositories before updating parent references.
5. As administrator, enable SEO on existing clients, assign active employees/heads and configure their existing authority grants. Verify an unassigned employee receives 403 and another company receives 404.
6. Connect a real Google account; map each client's exact property; manually synchronize one client and inspect logs and stored metrics against Search Console. Confirm connection refresh/reconnect and one real URL inspection. No live Google credentials or consenting account were available during local tests.
7. Import legacy sheets from browsers that hold the original data. Download archived originals and compare counts/months. Attribution of legacy backlinks requires manager review before they can count as verified work.
8. Verify task submission, independent approval and a single existing ledger entry. Verify PDF export and desktop/mobile layouts with representative production data. AI output requires configured Gemini and human review.
9. Set `SEO_JOBS_ENABLED=true` on the intended worker/API instance; monitor first daily sync and first monthly report. In multi-instance deployment, prefer enabling the scheduler on one instance to avoid duplicate AI generation calls, although database records remain unique.
10. Roll back UI/backend binaries if necessary; retain additive SEO tables and their data. Disable jobs first. Do not drop tables or erase historical data as part of routine rollback.

## Validation

A disposable MariaDB on `127.0.0.1:33317/stems_seo_test` was created from the original schema, then upgraded with the additive migration. Those initial tests did not query or migrate production. The later user-requested hosted connection and additive SEO schema application are documented above.

Commands (from parent checkout unless noted):

```
npx tsc -p backend/tsconfig.json --noEmit
npx tsc -p frontend/tsconfig.json --noEmit
DATABASE_URL=mysql://root@127.0.0.1:33317/stems_seo_test SEO_INTEGRATION_TEST=true NODE_ENV=test npx tsx --test backend/tests/seo.test.ts backend/tests/seo.integration.test.ts
```

Both backend and frontend production builds and TypeScript checks passed. Desktop (1440px) and mobile (390px) browser checks passed for section navigation, empty states, client forms and page overflow. The generated PDF was rendered and inspected.

The working-hours regression passed. The older initial WordPress test had an email-query mock mismatch; the latest upstream version fixes that test and it passes in the current 32-test run.

Tests cover encrypted-token tamper rejection, weighted metrics, date validation, task transitions, private-address rejection, real-anchor parsing, company/client assignment checks, authority denial, missing evidence, rejection history, concurrent approval/idempotent points, legacy card mutation rejection, repeat keyword import, bounded synchronization, retry rate limits, preliminary data, refresh of existing records, API failure preservation/logging, no Google calls on dashboard open, monthly report/PDF generation, OAuth PKCE/read-only scope/state replay rejection, multi-property discovery, encrypted connection responses, token-refresh coalescing and repeated legacy import.

Google responses in tests are explicit test fixtures, not production results. OAuth consent, Google quotas, production migrations, scheduler execution in the hosting environment and real AI responses still require staging acceptance.

## Current limits

- The initial 90-day history is intentionally bounded; importing older Search Console history needs an explicit backfill job. Reports cannot invent missing historical data.
- Query/page lists are the top 50 aggregated available rows; query comparisons only include rows returned in both selected periods. API privacy filtering and import caps remain applicable.
- Keyword and task/activity lists have bounded response sizes (2,000 keywords, 500 tasks/activities). Large-account cursor pagination and server-side table search remain follow-up work.
- Activity subfields are currently stored in typed-by-kind JSON records with searchable text in the UI; full crawler integration and a rich editorial calendar are outside this implementation.
- Automated backlink checks use accessible HTTPS IPv4 HTML, not a browser renderer. Inconclusive results need review.
- Automated report history has one saved snapshot per client/month; explicitly regenerating a report replaces that month's snapshot.


Official API references used during implementation:

- [Search Analytics query and data limits](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- [Search Console API reference](https://developers.google.com/webmaster-tools/v1/api_reference_index)
- [Sitemaps list and read-only scope](https://developers.google.com/webmaster-tools/v1/sitemaps/list)
- [URL Inspection](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect)
