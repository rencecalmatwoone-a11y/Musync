# Musync

A music guessing game with solo play, multiplayer lobbies, Spotify integration,
and Supabase authentication and game state.

## Project structure

```text
Musync/
|-- docs/              Deployment instructions
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
