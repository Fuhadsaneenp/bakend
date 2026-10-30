# AdSense Daily Views

Open Data Entry → AdSense Daily Views. Only DATE and PAGE_VIEWS are requested from AdSense Management API v2. Reports use OWNED_SITE_ID exact filters after paginated accounts/sites discovery validates trikonet.com and medbiomate.com. No other account fields are returned to the browser.

## Google setup

Enable AdSense Management API in the Google Cloud project used by the OAuth client. Configure its consent screen for https://www.googleapis.com/auth/adsense.readonly; add the authorizing administrator as a test user if the consent screen is in testing. Google may require verification or publishing for longer-lived production authorization.

Backend variables: ADSENSE_GOOGLE_CLIENT_ID, ADSENSE_GOOGLE_CLIENT_SECRET, ADSENSE_GOOGLE_REDIRECT_URI, ADSENSE_TOKEN_KEY (64 hex characters). Each falls back to its existing SEO equivalent where applicable: SEO_GOOGLE_CLIENT_ID, SEO_GOOGLE_CLIENT_SECRET, SEO_GOOGLE_REDIRECT_URI, SEO_TOKEN_KEY. They are never sent to the frontend. With the SEO callback fallback, the existing registered Search Console callback handles adsense-prefixed OAuth states separately. A dedicated client can register https://api.secondtales.com/api/adsense/google/callback instead. Do not change the existing Search Console redirect to add this feature.

An administrator must choose Connect AdSense and complete Google consent. If neither target site is accessible, connection fails. If only one is accessible, the other is marked unavailable. Credentials use AES-256-GCM encryption. OAuth uses PKCE and one-use database state expiring in 10 minutes, bound to the active administrator and company. Only SUPER_ADMIN and HR_ADMIN can manage a company connection. Report readers require adsense.views.view, assigned through Settings → Authority. Company boundaries apply independently of the selected website.

## Storage and sync

Uses existing CompanySetting unique(companyId,key), without database schema migration. adsense_connection_v1 stores encrypted credentials and validated site bindings. adsense_day:<account digest>:<website>:<YYYY-MM-DD> stores only daily page views and sync timestamp. Upserts replace revised values and prevent duplicates by company/account/site/date. Disconnect deletes local OAuth credentials, stops synchronization, and preserves stored report rows. Google-side grant removal can be performed in the Google account's permissions page; local disconnect does not revoke shared Search Console grants.

The server scheduler checks every minute and synchronizes connected websites every 30 minutes, re-fetching the current and previous calendar months. It resumes due work after a process restart and retries failures after 30 minutes. Open Website Views pages reload saved reports every 30 minutes. A durable 15-minute lease prevents overlapping sync across workers. ADSENSE_JOBS_ENABLED=false disables jobs explicitly. Hostinger's running Node process must be available for scheduled work; on-demand hosting catches up on process startup. Manual Refresh also fetches today and the recent 30 days plus an applied custom range. Date ranges are capped at 366 days and future dates are rejected. Reports use ACCOUNT_TIME_ZONE, displayed in the UI. Today's values are marked incomplete. Missing stored dates remain null rather than fabricated zeros; valid reports without a row for a day produce zero for that day. Warnings, truncation, invalid values, and failed reports retain prior successful data.

## Verification

Run tests/adsense.test.ts and tests/adsense-permissions.test.ts with tsx --test. They mock Google and the database and cover metrics, exact-site filters, token encryption/tampering, refresh, OAuth replay, revised values, duplicates, tenant isolation, missing site access, disconnect, and route permissions. A live Google report requires the human administrator's consent and cannot be verified from an unconnected account.

## Separate Google accounts per website

Each website now has its own encrypted connection at adsense_connection_v1:<domain>. Select a website before Connect, Refresh, or Disconnect. OAuth state binds consent to that website, and Google opens the account chooser. Only the chosen website is saved, even if the account can access both. Reconnecting or disconnecting one site does not affect the other. Original shared connections remain readable for their validated sites and are copied into per-website storage on sync; historical daily keys stay unchanged. Daily jobs iterate and lock each website independently.


Two-hour snapshots: immutable first successful observations at 10, 12, 14, 16, 18, 20 and 22 in the reporting account timezone, accepted within the following 30 minutes. Keys include account digest, website, date and hour. No missed checkpoint is backfilled. Reports compare today and yesterday at matching checkpoints, with actual capture times, and highlight the highest positive increase between adjacent captured checkpoints. Snapshot history begins at deployment; daily totals cannot reconstruct earlier intraday values.

Monthly summaries show the selected month's highest observed day(s), total, previous period peak and total, and absolute/percentage change. Current-month comparisons use elapsed calendar days capped to the previous month's length; historical months compare full months. Totals remain null until every date is stored; peak coverage is shown. Sync fetches current and previous months, plus the selected custom period and its preceding month when older history is requested.
