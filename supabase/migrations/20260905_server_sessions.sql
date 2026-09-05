-- Server-only Spotify tokens and single-use OAuth state for Vercel functions.
-- No browser role may access this table, even with an authenticated user.
create table if not exists public.server_sessions (
  id text primary key,
  data jsonb not null,
  expires_at timestamptz not null
);

alter table public.server_sessions enable row level security;
revoke all on table public.server_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.server_sessions to service_role;
create index if not exists server_sessions_expires_at_idx
  on public.server_sessions (expires_at);

-- Expired rows are ignored by the server. Run periodically to reclaim storage:
-- delete from public.server_sessions where expires_at <= now();
