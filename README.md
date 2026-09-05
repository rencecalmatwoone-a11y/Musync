# Musync

A music guessing game with solo play, multiplayer lobbies, Spotify integration,
and Supabase authentication and game state.

## Deploy to Vercel

Follow the [Vercel deployment guide](docs/VERCEL.md) for the exact settings,
environment variables, SQL migration, and authentication callback URLs.
The repository includes a static build and a Node.js API function.

## Local development

1. Install a current Node.js LTS release and run `npm ci`.
2. Copy `.env.example` to `.env` and fill in your integration credentials.
3. Follow [Supabase setup](supabase/README.md) for online multiplayer.
4. Run `npm run dev` and open the URL printed by the server (normally
   `http://127.0.0.1:5173`).

The browser loads React and HTM from esm.sh, so an internet connection is needed.
Local development serves native JavaScript modules directly. For Vercel,
`npm run build` copies the browser assets into `dist/` without bundling them.
Restart the server after changing `.env`. Keep credentials out of Git.

## Project structure

```text
Musync/
|-- docs/reports/       Historical audits and investigation reports
|-- public/            Static public assets
|-- scripts/           Project validation and diagnostic scripts
|-- server/
|   |-- index.js        HTTP server, API routes, and environment loading
|   `-- services/       Server-side Spotify and audio provider integrations
|-- src/
|   |-- components/    React UI components
|   |-- data/          Track catalogs and selection logic
|   |-- hooks/         React state, gameplay, and audio hooks
|   |-- spotify/       Browser-side Spotify API client
|   |-- supabase/      Browser-side database and realtime clients
|   |-- App.js         Application composition
|   |-- main.js        Browser entry point
|   |-- index.css      Application styles
|   `-- *.js           Shared presentation and game helpers
|-- supabase/
|   |-- migrations/    Incremental SQL changes
|   |-- schema.sql     Database schema
|   `-- README.md      Database setup instructions
|-- .env.example       Environment configuration template
|-- index.html         HTML entry point
|-- server.js          Compatible server launcher
`-- package.json       Dependencies and project commands
```

Keep browser code under `src/`, backend integrations under `server/services/`,
and public assets under `public/`. Only the HTML entry point, `src/`, and
`public/` are served as static files. The server generates
`/src/spotify/config.js` and `/src/supabase/config.js` at runtime; these are not
missing source files.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the static Vercel output in `dist/` |
| `npm run dev` | Start the local server |
| `npm start` | Start the server using the current environment |
| `npm run check` | Check JavaScript syntax and relative import targets |
| `npm test` | Run the existing track selection assertions |
| `npm run test:deployment` | Verify API, OAuth, session persistence, and build isolation |
| `npm run check:selection` | Print randomized track selection diagnostics |

`PORT` defaults to `5173`. `HOST` defaults to `127.0.0.1`, or `0.0.0.0` when
`NODE_ENV=production`. The root launcher remains available for deployments that
already use `node server.js`.

## Reports

The [forensic audit](docs/reports/FORENSIC_AUDIT_REPORT.md) is a historical
snapshot. Its original root-level backend paths now correspond to
`server/index.js` and `server/services/spotify.js`; its findings may not describe
the current application.
