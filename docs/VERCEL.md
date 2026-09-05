# Deploy Musync to Vercel

## 1. Prepare Supabase

For a new database, run `supabase/schema.sql` in the Supabase SQL Editor.
For both new and existing databases, apply the files in `supabase/migrations/`
in filename order. The `20260905_server_sessions.sql` migration adds a private
table for Spotify sessions and single-use OAuth state. It does not change player data.

Follow [Supabase setup](../supabase/README.md) to enable email/anonymous sign-ins
and Realtime. The browser uses the anon key; the API uses the service role key
only for its private session table. Never expose the service role key in browser code.

## 2. Import the repository

Push your project changes to your Git repository, then use **Add New → Project**
in Vercel and import it. Keep the root directory at the repository root.

The committed `vercel.json` supplies these settings:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Node.js | 24.x (from `package.json`) |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

Static HTML, JavaScript, CSS, and images are served from `dist/`. `/api/*` and
the two generated config modules are routed to `api/index.js`, which exports
the existing HTTP handler without starting a listener. This follows Vercel's
[Node function](https://vercel.com/docs/functions/runtimes/node-js) and
[project configuration](https://vercel.com/docs/project-configuration/vercel-json) support.

## 3. Add environment variables

In Vercel's project settings, add these for **Production** before deploying.
Use your real values, not the placeholders from `.env.example`.

| Variable | Value / purpose |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase legacy `service_role` key; server only; required for Spotify login |
| `SPOTIFY_CLIENT_ID` | Your Spotify developer application client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify client secret; server only |
| `PUBLIC_BASE_URL` | Your stable live origin, e.g. `https://your-project.vercel.app` |
| `SPOTIFY_PRODUCTION_REDIRECT_URI` | The same origin followed by `/api/spotify/callback` |

No `VITE_` or `NEXT_PUBLIC_` prefixes are used. Do not set `PORT`, `HOST`, or
`SPOTIFY_LOCAL_REDIRECT_URI` in Vercel. If you already set `SPOTIFY_REDIRECT_URI`,
remove it or update it to the live callback; it takes precedence over other URLs.
Vercel environment variables are read at runtime, and `.env` is excluded from deployments.

The homepage can be deployed without integration credentials, but Supabase
features and Spotify login require their corresponding configuration.

## 4. Configure live authentication URLs

1. In your Spotify developer app settings, add the **exact** production callback
   URL from the table above to its redirect URI allowlist and save.
2. In Supabase **Authentication → URL Configuration**, set **Site URL** to your
   live origin and add that origin to the allowed redirect URLs. Add any actual
   email-confirmation/reset callback paths you use.
3. Click **Deploy** in Vercel. If the domain was not known until the first deploy,
   update the two URL variables and provider settings, then **Redeploy**.

For Spotify login on a preview deployment, configure a stable preview domain,
set its Preview environment callback variables, and allowlist that exact URL
in Spotify. OAuth cookies must return to the same host where login started;
do not send preview logins to the production callback. Use the canonical live
domain when logging in, including when a deployment also has an alternate URL.

## 5. Verify the deployment

Before pushing:

```sh
npm ci
npm run check
npm test
npm run build
npm run test:deployment
```

After deployment:

- Open the homepage and reload it; check that styles and images load.
- Open `/src/supabase/config.js` and verify it contains only the public URL/key.
- Open `/api/spotify/status` without a login; it should return JSON.
- Sign in to Supabase and verify two browsers can join the same multiplayer lobby.
- Connect Spotify, verify account status and playback, then sign out. Spotify
  playback remains subject to the account and app permissions required by Spotify.

The automated deployment tests mock external providers. Actual Spotify playback,
database policies, and multiplayer still need these live checks.

Spotify sessions expire after 30 days without a token refresh. Expired records
cannot be used; periodically run the cleanup query at the end of the session
migration to reclaim storage. Catalog caches remain temporary per function.

If login returns `SERVER_UNAVAILABLE`, check the service role key and session
migration. If Spotify reports a redirect mismatch, compare the callback URL
character for character with the Spotify allowlist. Environment changes require
a new deployment. The browser also needs access to esm.sh and the font CDNs.
