# Musync Multiplayer — Supabase setup

This folder contains everything needed to back multiplayer with a real Supabase
backend: lobby codes, invite/join, ready status, sessions, rounds, per-player
answers/scores/streaks, match results, and the leaderboard.

## 1. Create the schema

1. In your Supabase project, open the **SQL Editor**.
2. Run the contents of [`schema.sql`](./schema.sql). This creates:
   - `profiles` — player identity linked to `auth.users`
   - `lobbies` + `lobby_members` — private rooms with a unique 6-char `code`,
     ready/status flags, host flag
   - `game_sessions` + `session_rounds` — one match + round rows with
     **authoritative** `started_at` / `end_at` timestamps (drives the shared
     song, round number, and 10-second timer for every player)
   - `session_players` — independent running score / streak / correct / asked
   - `player_answers` — each player's single locked answer per round
   - `match_results` + `leaderboard` view — persisted results + live table
   - Row Level Security policies and database functions:
     `create_lobby`, `join_lobby`, `set_ready`, `leave_lobby`, `start_match`,
     `advance_round`, `submit_answer`, `finalize_match`
   - A trigger that auto-creates a profile on sign-up

## 2. Enable Supabase Auth

After the base schema, apply every SQL file in `migrations/` in filename order.
Vercel deployments need `20260905_server_sessions.sql` for persistent Spotify
sessions. See the [deployment guide](../docs/VERCEL.md) for server credentials
and live authentication URLs.

- **Authentication → Providers → Email**: enable email.
- Anonymous sign-ins require **Authentication → Settings** →
  enable **Allow anonymous sign-ins**.

## 3. Enable Realtime

- **Database → Replication**: enable **Realtime** for the tables you want
  synchronized (`lobbies`, `lobby_members`, `game_sessions`,
  `session_rounds`, `session_players`, `player_answers`, `match_results`).
  The app subscribes to `postgres_changes` on `public` for these tables.

## 4. Provide credentials (env vars)

Copy `.env.example` to `.env` and fill in your project values
(**Project Settings → API → Project URL** + **anon public key**):

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
```

The dev server reads this file at startup and injects it into the browser via
`/src/supabase/config.js`. `.env` is gitignored — never commit it.

Restart the server after adding the file:
```
npm run dev
```

## How the online flow maps to the existing UI

- When Supabase is configured **and** the player is authenticated, the
  Multiplayer lobby shows a **PLAY ONLINE** option. The existing Friend Lobby
  UI is reused: create a room (unique 6-char code + invite link), join by code,
  mark ready, and both players start the match once ready.
- The shared song / round / 10-second timer come from
  `game_sessions.round_started_at` / `round_end_at`, so every client converges
  on the same timing. Each player's locked answer, score, and streak are stored
  in `player_answers` / `session_players` independently.
- Results are finalized via `finalize_match`, persisted to `match_results`,
  and the `leaderboard` view updates in realtime.
- **Exit Game** never leaves instantly. In the multiplayer match, an **EXIT
  GAME** button opens a **“Leave this game?”** confirmation (Cancel keeps you
  in the match). **Leave Game** calls the `leave_lobby` RPC, which removes only
  your `lobby_members` row and your `session_players` stats — the running
  match, the other player's data, and the leaderboard are untouched — then the
  client tears down its realtime subscription and returns to the online lobby.
- **Solo takeover / auto-win:** if leaving a live match reduces the lobby to a
  single remaining player, `leave_lobby` finalizes the match immediately. The
  last remaining player is ranked #1, `match_results` are persisted, the
  leaderboard updates, and their client transitions to the results screen
  showing who won.

## Client modules

- `src/supabase/client.js` — Supabase client singleton + config flag
- `src/supabase/db.js` — data-access layer (lobbies, sessions, rounds,
  answers, results, leaderboard)
- `src/supabase/realtime.js` — Realtime `postgres_changes` subscriptions
- `src/hooks/useSupabaseAuth.js` — Auth state (anonymous + email/password)
- `src/hooks/useOnlineLobby.js` — lobby create/join/ready + session/round sync
- `src/hooks/useOnlineGame.js` — synchronized gameplay (shared round/timer,
  independent answers/scores)
- `src/components/AuthPanel.js` — sign-in / sign-up / anonymous UI
