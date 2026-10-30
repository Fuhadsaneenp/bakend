# AdSense Daily Views

Open Data Entry → AdSense Daily Views. Only DATE and PAGE_VIEWS are requested from AdSense Management API v2. Reports use OWNED_SITE_ID exact filters after paginated accounts/sites discovery validates trikonet.com and medbiomate.com. No other account fields are returned to the browser.

## Google setup

Enable AdSense Management API in the Google Cloud project used by the OAuth client. Configure its consent screen for https://www.googleapis.com/auth/adsense.readonly; add the authorizing administrator as a test user if the consent screen is in testing. Google may require verification or publishing for longer-lived production authorization.

Backend variables: ADSENSE_GOOGLE_CLIENT_ID, ADSENSE_GOOGLE_CLIENT_SECRET, ADSENSE_GOOGLE_REDIRECT_URI, ADSENSE_TOKEN_KEY (64 hex characters). Each falls back to its existing SEO equivalent where applicable: SEO_GOOGLE_CLIENT_ID, SEO_GOOGLE_CLIENT_SECRET, SEO_GOOGLE_REDIRECT_URI, SEO_TOKEN_KEY. They are never sent to the frontend. With the SEO callback fallback, the existing registered Search Console callback handles adsense-prefixed OAuth states separately. A dedicated client can register https://api.secondtales.com/api/adsense/google/callback instead. Do not change the existing Search Console redirect to add this feature.

An administrator must choose Connect AdSense and complete Google consent. If neither target site is accessible, connection fails. If only one is accessible, the other is marked unavailable. Credentials use AES-256-GCM encryption. OAuth uses PKCE and one-use database state expiring in 10 minutes, bound to the active administrator and company. Only SUPER_ADMIN and HR_ADMIN can manage a company connection. Report readers require adsense.views.view, assigned through Settings → Authority. Company boundaries apply independently of the selected website.

## Storage and sync

Uses existing CompanySetting unique(companyId,key), without database schema migration. adsense_connection_v1 stores encrypted credentials and validated site bindings. adsense_day:<account digest>:<website>:<YYYY-MM-DD> stores only daily page views and sync timestamp. Upserts replace revised values and prevent duplicates by company/account/site/date. Disconnect deletes local OAuth credentials, stops synchronization, and preserves stored report rows. Google-side grant removal can be performed in the Google account's permissions page; local disconnect does not revoke shared Search Console grants.

The server scheduler checks hourly and runs at most once per account-local calendar day, re-fetching the latest 30 days. It resumes due work after a process restart and retries failures hourly. A durable 15-minute lease prevents overlapping sync across workers. ADSENSE_JOBS_ENABLED=false disables jobs explicitly. Hostinger's running Node process must be available for scheduled work; on-demand hosting catches up on process startup. Manual Refresh also fetches today and the recent 30 days plus an applied custom range. Date ranges are capped at 366 days and future dates are rejected. Reports use ACCOUNT_TIME_ZONE, displayed in the UI. Today's values are marked incomplete. Missing stored dates remain null rather than fabricated zeros; valid reports without a row for a day produce zero for that day. Warnings, truncation, invalid values, and failed reports retain prior successful data.

## Verification

Run tests/adsense.test.ts and tests/adsense-permissions.test.ts with tsx --test. They mock Google and the database and cover metrics, exact-site filters, token encryption/tampering, refresh, OAuth replay, revised values, duplicates, tenant isolation, missing site access, disconnect, and route permissions. A live Google report requires the human administrator's consent and cannot be verified from an unconnected account.
