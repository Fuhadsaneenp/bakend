# Google Sheets connection setup

Company administrators can open **Google Sheets connection** in Data Entry → Company Master Sheet or My Sheet.

1. Enable Google Sheets API in the Google Cloud project used by STEMS OAuth.
2. Configure the consent screen for `https://www.googleapis.com/auth/spreadsheets`. Add the authorizing account as a test user if the OAuth app is in testing. This permission is for spreadsheets accessible to the Google account; Google does not restrict this scope to one worksheet.
3. Configure `SHEETS_GOOGLE_CLIENT_ID`, `SHEETS_GOOGLE_CLIENT_SECRET`, and `SHEETS_GOOGLE_REDIRECT_URI`, or reuse the existing `SEO_GOOGLE_*` OAuth web client. Tokens use the existing `SEO_TOKEN_KEY` authenticated encryption key.
4. The existing registered frontend URI `/api/google/callback` forwards to the backend SEO callback, which dispatches Sheets states separately. Alternatively register `/api/google-sheets/callback` and set SHEETS_GOOGLE_REDIRECT_URI to its full public URL.
5. Click Connect Google and grant access. Paste a spreadsheet link, load worksheets, choose one, select direction and Save connection.

Company Master two-way sync is available after selecting a worksheet and enabling it. Row 2 must contain Date, Source URL, Platform, Assigned To, Assignment Status, Upload Status, Task ID, Updated At in columns A:H. Data begins in row 3. The server checks every 30 seconds, independently of browser activity. Stable Task IDs match records; new IDs are generated for Sheet-side additions. Date selector/header rows and other worksheets are untouched. Dates are written as numeric spreadsheet dates using existing formatting.

Independent field edits merge against the previous successful snapshot. On a simultaneous edit of the same field, STEMS retains its value. Clearing/removing rows does not delete the counterpart; delete within STEMS for its existing deletion workflow. Invalid/ambiguous assignees or duplicate IDs stop the cycle with a visible error. A database lease prevents concurrent worker syncs. A second Google read detects intervening changes before writing, although Google values API does not provide atomic compare-and-swap against edits made after that check. Only changed managed rows are written. My Sheet personal entries remain outside the Master sync.

Status exposes syncEnabled, lastSyncAt and syncError. POST /google-sheets/sync/enable performs initial reconciliation and enables two-way background sync. POST /google-sheets/sync retries immediately. Selecting another worksheet disables syncing until explicitly re-enabled.

Connections are isolated by authenticated company. Only SUPER_ADMIN and HR_ADMIN accounts may manage them, and employee impersonation sessions are rejected. Google credentials never appear in browser responses. OAuth state expires after ten minutes and is consumed once. Disconnect removes the encrypted tokens from STEMS without changing the source spreadsheet; Google account permissions can additionally be revoked in Google Account settings.
