# Connect Google Search Console

The Search Console page shows stored clicks, impressions, CTR, average position, a daily chart, and top queries/pages/countries/devices. Missing performance is displayed as unavailable until Google data is synchronized.

## One-time Google setup

1. Open Google Cloud Console and select or create the STEMS project.
2. Enable **Google Search Console API**.
3. Configure Google Auth Platform branding and audience. While the app is in Testing, add the Google accounts that will connect as test users.
4. Add read-only scope `https://www.googleapis.com/auth/webmasters.readonly` under Data access.
5. Create an OAuth client of type **Web application**. Register this exact authorized redirect URI for localhost:
   `http://localhost:4000/api/seo/google/callback`
6. Configure the ignored `backend/.env` file:

```dotenv
SEO_GOOGLE_CLIENT_ID=<Google web client ID>
SEO_GOOGLE_CLIENT_SECRET=<Google web client secret>
SEO_GOOGLE_REDIRECT_URI=http://localhost:4000/api/seo/google/callback
```

Keep the existing `SEO_TOKEN_KEY` unchanged; it encrypts stored Google tokens. Never add OAuth secrets or tokens to frontend environment variables or commit them. Restart the backend after environment changes.

Production needs its own registered HTTPS redirect URI matching the production backend configuration.

## Connect a client

1. Sign in as a STEMS administrator. Open SEO → Search Console and select the client.
2. Click **Connect Google** and choose a Google account with access to the correct Search Console property. Grant read-only access.
3. After returning to STEMS, select the intended client and its Search Console property, then click **Save property**. Domain and URL-prefix properties are supported. One authorization can provide multiple properties for assignment to different clients.
4. Click **Sync now**. The first import retrieves the last 90 days of available data. Refresh after the sync completes; subsequent reads use stored data. Manual sync is rate limited to once per 15 minutes per client.
5. Choose the reporting period. Click metric cards to toggle chart lines, or choose Queries, Pages, Countries, and Devices.

The local extra job worker is disabled to avoid duplicating production jobs while localhost uses the live database. Use manual sync for local testing. Production daily synchronization must have one enabled worker. Google may delay, filter, or limit returned rows; query/page totals can differ from site totals.

References:
- https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
- https://developers.google.com/identity/protocols/oauth2/web-server
