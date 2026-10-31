# Google Sheets connection setup

Company administrators can open **Google Sheets connection** in Data Entry → Company Master Sheet or My Sheet.

1. Enable Google Sheets API in the Google Cloud project used by STEMS OAuth.
2. Configure the consent screen for `https://www.googleapis.com/auth/spreadsheets`. Add the authorizing account as a test user if the OAuth app is in testing. This permission is for spreadsheets accessible to the Google account; Google does not restrict this scope to one worksheet.
3. Configure `SHEETS_GOOGLE_CLIENT_ID`, `SHEETS_GOOGLE_CLIENT_SECRET`, and `SHEETS_GOOGLE_REDIRECT_URI`, or reuse the existing `SEO_GOOGLE_*` OAuth web client. Tokens use the existing `SEO_TOKEN_KEY` authenticated encryption key.
4. The existing registered frontend URI `/api/google/callback` forwards to the backend SEO callback, which dispatches Sheets states separately. Alternatively register `/api/google-sheets/callback` and set SHEETS_GOOGLE_REDIRECT_URI to its full public URL.
5. Click Connect Google and grant access. Paste a spreadsheet link, load worksheets, choose one, select direction and Save connection.

This release prepares the connection only: it reads metadata and saves the selected worksheet/direction. It does not import, overwrite, delete or synchronize cell data. Column mapping, stable row identities and conflict handling must be configured before enabling transfers. The API always reports `syncEnabled: false`.

Connections are isolated by authenticated company. Only SUPER_ADMIN and HR_ADMIN accounts may manage them, and employee impersonation sessions are rejected. Google credentials never appear in browser responses. OAuth state expires after ten minutes and is consumed once. Disconnect removes the encrypted tokens from STEMS without changing the source spreadsheet; Google account permissions can additionally be revoked in Google Account settings.
