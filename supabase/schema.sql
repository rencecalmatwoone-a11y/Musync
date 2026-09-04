-- =============================================================================
-- Musync Multiplayer — Supabase database schema
-- =============================================================================
-- Run this in the Supabase SQL editor (or `supabase db push`) against your
-- project. Extensions + tables + security (RLS) + functions + seed data.
--
-- Tables:
--   profiles           player identity profile linked to auth.users
--   lobbies            a private lobby with a unique 6-char code
--   lobby_members      players inside a lobby + ready status
--   game_sessions      one per started match (song order, current round)
--   session_rounds     per session per round (song, authoritative timings)
--   session_players    running per-player score/streak/correct within a session
--   player_answers     the locked answer a player submitted for a round
--   match_results      persisted final results per session per player
--   leaderboard        global lifetime leaderboard (view over results)
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- PROFILES
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default 'Player',
  avatar_url    text,
  created_at    timestamptz not null default now()
);

-- Automatically create a profile on sign-up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, 'Player'), '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- -----------------------------------------------------------------------------
-- LOBBIES
-- -----------------------------------------------------------------------------
create table if not exists public.lobbies (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  host_id      uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'lobby',          -- lobby | live | finished
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- LOBBY MEMBERS (players + ready status)
-- -----------------------------------------------------------------------------
create table if not exists public.lobby_members (
  id          uuid primary key default gen_random_uuid(),
  lobby_id    uuid not null references public.lobbies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  ready       boolean not null default false,
  host        boolean not null default false,
  joined_at   timestamptz not null default now(),
  unique (lobby_id, user_id)
);

-- -----------------------------------------------------------------------------
-- GAME SESSIONS (one per started match)
-- -----------------------------------------------------------------------------
create table if not exists public.game_sessions (
  id            uuid primary key default gen_random_uuid(),
  lobby_id      uuid not null references public.lobbies (id) on delete cascade,
  status        text not null default 'live',           -- live | finished
  song_order    jsonb not null default '[]'::jsonb,     -- ordered array of song ids
  current_round integer not null default 0,
  round_started_at timestamptz,                          -- authoritative start ts
  round_end_at     timestamptz,                          -- authoritative end ts
  created_at    timestamptz not null default now(),
  unique (lobby_id)
);

-- -----------------------------------------------------------------------------
-- SESSION ROUNDS (song + authoritative timing per round)
-- -----------------------------------------------------------------------------
create table if not exists public.session_rounds (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.game_sessions (id) on delete cascade,
  round_number   integer not null,
  song_id        text not null,
  track          jsonb not null default '{}'::jsonb,
  duration_sec   integer not null default 10,
  started_at     timestamptz not null,
  end_at         timestamptz not null,
  unique (session_id, round_number)
);

-- -----------------------------------------------------------------------------
-- SESSION PLAYERS (running score / streak / correct per player in a session)
-- -----------------------------------------------------------------------------
create table if not exists public.session_players (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.game_sessions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  score       integer not null default 0,
  streak      integer not null default 0,
  correct     integer not null default 0,
  asked       integer not null default 0,
  unique (session_id, user_id)
);

-- -----------------------------------------------------------------------------
-- PLAYER ANSWERS (one independent locked answer per round per player)
-- -----------------------------------------------------------------------------
create table if not exists public.player_answers (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.game_sessions (id) on delete cascade,
  round_number integer not null,
  user_id      uuid not null references auth.users (id) on delete cascade,
  answer_id    text not null,                  -- the chosen option id
  is_correct   boolean not null,
  points       integer not null default 0,
  answered_at  timestamptz not null default now(),
  unique (session_id, round_number, user_id)
);

-- -----------------------------------------------------------------------------
-- MATCH RESULTS (persisted final results per session per player)
-- -----------------------------------------------------------------------------
create table if not exists public.match_results (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.game_sessions (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  score        integer not null default 0,
  correct      integer not null default 0,
  asked        integer not null default 0,
  accuracy     integer not null default 0,
  rank         integer,
  finished_at  timestamptz not null default now(),
  unique (session_id, user_id)
);

-- -----------------------------------------------------------------------------
-- GLOBAL LEADERBOARD (lifetime aggregate by player)
-- -----------------------------------------------------------------------------
create or replace view public.leaderboard as
select
  user_id,
  max(display_name) as display_name,
  count(*) as matches_played,
  sum(score) as total_score,
  sum(correct) as total_correct,
  sum(asked) as total_asked,
  case when sum(asked) > 0 then round((sum(correct)::numeric / sum(asked)) * 100) else 0 end as accuracy
from public.match_results
group by user_id;

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.lobbies        enable row level security;
alter table public.lobby_members  enable row level security;
alter table public.game_sessions  enable row level security;
alter table public.session_rounds enable row level security;
alter table public.session_players enable row level security;
alter table public.player_answers enable row level security;
alter table public.match_results  enable row level security;

-- Profiles: users can read/update their own, read all for leaderboard/members
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (true);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Lobbies: members can read, host can insert/update, deletion when host
drop policy if exists "lobbies_select" on public.lobbies;
create policy "lobbies_select" on public.lobbies
  for select using (
    exists (select 1 from public.lobby_members m where m.lobby_id = id and m.user_id = auth.uid())
  );
drop policy if exists "lobbies_insert" on public.lobbies;
create policy "lobbies_insert" on public.lobbies
  for insert with check (host_id = auth.uid());
drop policy if exists "lobbies_update_host" on public.lobbies;
create policy "lobbies_update_host" on public.lobbies
  for update using (host_id = auth.uid());

-- Lobby members: readable by members of the same lobby.
-- NOTE: the membership check must NOT reference lobby_members directly from its
-- own policy (that would cause "infinite recursion detected in policy for
-- relation lobby_members"). A SECURITY DEFINER helper bypasses RLS internally,
-- so it can safely query lobby_members without recursing.
create or replace function public.is_lobby_member(p_lobby_id uuid)
returns boolean
language sql security definer stable as $$
  select exists(
    select 1 from public.lobby_members
    where lobby_id = p_lobby_id and user_id = auth.uid()
  )
$$;

-- Use the definer helper for lobby reads too. Referencing lobby_members
-- directly from this policy can hide the just-created lobby under RLS.
drop policy if exists "lobbies_select" on public.lobbies;
create policy "lobbies_select" on public.lobbies
  for select using ( public.is_lobby_member(id) );

drop policy if exists "members_select" on public.lobby_members;
create policy "members_select" on public.lobby_members
  for select using ( public.is_lobby_member(lobby_id) );
drop policy if exists "members_insert" on public.lobby_members;
create policy "members_insert" on public.lobby_members
  for insert with check (user_id = auth.uid());
drop policy if exists "members_update_own" on public.lobby_members;
create policy "members_update_own" on public.lobby_members
  for update using (user_id = auth.uid());

-- Game sessions: members can read/update (sync via realtime)
drop policy if exists "sessions_select" on public.game_sessions;
create policy "sessions_select" on public.game_sessions
  for select using (
    exists (select 1 from public.lobby_members m where m.lobby_id = game_sessions.lobby_id and m.user_id = auth.uid())
  );
drop policy if exists "sessions_insert" on public.game_sessions;
create policy "sessions_insert" on public.game_sessions
  for insert with check (
    exists (select 1 from public.lobbies l where l.id = game_sessions.lobby_id and l.host_id = auth.uid())
  );
drop policy if exists "sessions_update" on public.game_sessions;
create policy "sessions_update" on public.game_sessions
  for update using (
    exists (select 1 from public.lobby_members m where m.lobby_id = game_sessions.lobby_id and m.user_id = auth.uid())
  );

-- Session rounds: members can read; host can insert/update
drop policy if exists "rounds_select" on public.session_rounds;
create policy "rounds_select" on public.session_rounds
  for select using (
    exists (
      select 1 from public.game_sessions s
      join public.lobby_members m on m.lobby_id = s.lobby_id
      where s.id = session_id and m.user_id = auth.uid()
    )
  );
drop policy if exists "rounds_insert" on public.session_rounds;
create policy "rounds_insert" on public.session_rounds
  for insert with check (
    exists (
      select 1 from public.game_sessions s
      where s.id = session_id and s.status = 'live'
    )
  );
drop policy if exists "rounds_update" on public.session_rounds;
create policy "rounds_update" on public.session_rounds
  for update using (
    exists (
      select 1 from public.game_sessions s
      where s.id = session_id
    )
  );

-- Session players: members can read/update own row within a session
drop policy if exists "splayers_select" on public.session_players;
create policy "splayers_select" on public.session_players
  for select using (
    exists (
      select 1 from public.game_sessions s
      join public.lobby_members m on m.lobby_id = s.lobby_id
      where s.id = session_id and m.user_id = auth.uid()
    )
  );
drop policy if exists "splayers_insert" on public.session_players;
create policy "splayers_insert" on public.session_players
  for insert with check (user_id = auth.uid());
drop policy if exists "splayers_update_own" on public.session_players;
create policy "splayers_update_own" on public.session_players
  for update using (user_id = auth.uid());

-- Player answers: members can insert own answers, read within the session
drop policy if exists "answers_select" on public.player_answers;
create policy "answers_select" on public.player_answers
  for select using (
    exists (
      select 1 from public.game_sessions s
      join public.lobby_members m on m.lobby_id = s.lobby_id
      where s.id = session_id and m.user_id = auth.uid()
    )
  );
drop policy if exists "answers_insert" on public.player_answers;
create policy "answers_insert" on public.player_answers
  for insert with check (user_id = auth.uid());

-- Match results: members can read; inserting is via the finish function (definer)
drop policy if exists "results_select" on public.match_results;
create policy "results_select" on public.match_results
  for select using (true);

-- -----------------------------------------------------------------------------
-- STORED FUNCTIONS
-- -----------------------------------------------------------------------------

-- Create a lobby with a guaranteed-unique 6-char code
create or replace function public.create_lobby(p_display_name text)
returns public.lobbies
language plpgsql
security definer set search_path = public
as $$
declare
  new_code text;
  new_id   uuid := gen_random_uuid();
  ret      public.lobbies;
begin
  -- Generate a unique code (retry on collision)
  loop
    new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.lobbies where code = new_code);
  end loop;

  insert into public.lobbies (id, code, host_id) values (new_id, new_code, auth.uid());
  insert into public.lobby_members (lobby_id, user_id, display_name, host, ready)
  values (new_id, auth.uid(), coalesce(nullif(p_display_name,''), 'Player'), true, false);

  select * into ret from public.lobbies where id = new_id;
  return ret;
end;
$$;

-- Join a lobby by its 6-char code
create or replace function public.join_lobby(p_code text, p_display_name text)
returns public.lobbies
language plpgsql
security definer set search_path = public
as $$
declare
  lob public.lobbies;
begin
  select * into lob from public.lobbies where code = upper(p_code) and status = 'lobby';
  if lob is null then
    raise exception 'LOBBY_NOT_FOUND';
  end if;

  insert into public.lobby_members (lobby_id, user_id, display_name)
  values (lob.id, auth.uid(), coalesce(nullif(p_display_name,''), 'Player'))
  on conflict (lobby_id, user_id) do update set display_name = excluded.display_name;

  return lob;
end;
$$;

-- Mark the current user's ready status in a lobby
create or replace function public.set_ready(p_lobby_id uuid, p_ready boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.lobby_members
  set ready = p_ready
  where lobby_id = p_lobby_id and user_id = auth.uid();
end;
$$;

-- Safely remove the current user from a lobby (exit game / leave match).
-- Deletes only the leaving player's own lobby membership and their per-session
-- stats. The match itself (game_sessions / session_rounds) and the other
-- player's live session data are untouched. If this leaves the lobby with a
-- single player mid-match, the game ends immediately and the remaining player
-- wins: the match is finalized so match_results + the leaderboard reflect it.
create or replace function public.leave_lobby(p_lobby_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  sid        uuid;
  remaining  int;
begin
  select id into sid from public.game_sessions
  where lobby_id = p_lobby_id and status = 'live';

  if sid is not null then
    delete from public.session_players
    where session_id = sid and user_id = auth.uid();
  end if;

  delete from public.lobby_members
  where lobby_id = p_lobby_id and user_id = auth.uid();

  -- A live match reduced to one remaining player: that player wins by
  -- default, so finalize now so the standings + leaderboard settle.
  if sid is not null then
    select count(*) into remaining
    from public.lobby_members
    where lobby_id = p_lobby_id;

    if remaining <= 1 then
      perform public.finalize_match(sid);
    end if;
  end if;
end;
$$;

-- Start the match: build session + rounds, flip lobby/round state
drop function if exists public.start_match(uuid, jsonb, jsonb, integer);
create or replace function public.start_match(
  p_lobby_id uuid,
  p_song_order jsonb,
  p_round_duration integer default 10
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  s_id   uuid := gen_random_uuid();
  members int;
  ready_members int;
  unique_songs int;
  now_ts timestamptz := now();
  i      int;
  song_id text;
begin
  if not exists (
    select 1 from public.lobbies where id = p_lobby_id and host_id = auth.uid() and status = 'lobby'
  ) then
    raise exception 'ONLY_HOST_CAN_START';
  end if;

  select count(*), count(*) filter (where ready)
  into members, ready_members
  from public.lobby_members where lobby_id = p_lobby_id;
  if members < 2 then
    raise exception 'NOT_ENOUGH_PLAYERS';
  end if;
  if ready_members <> members then
    raise exception 'PLAYERS_NOT_READY';
  end if;
  if jsonb_typeof(p_song_order) <> 'array' or jsonb_array_length(p_song_order) <> 10 then
    raise exception 'INVALID_SONG_ORDER';
  end if;
  select count(distinct song->>'id') into unique_songs
  from jsonb_array_elements(p_song_order) as song;
  if unique_songs <> 10 or exists (
    select 1 from jsonb_array_elements(p_song_order) as song
    where jsonb_typeof(song) <> 'object' or nullif(trim(song->>'id'), '') is null
  ) then
    raise exception 'INVALID_SONG_ORDER';
  end if;

  -- Session
  insert into public.game_sessions (id, lobby_id, song_order, current_round, status,
    round_started_at, round_end_at)
  values (s_id, p_lobby_id, p_song_order, 1, 'live',
    now_ts, now_ts + (p_round_duration || ' seconds')::interval);

  -- Per-player session stat rows
  insert into public.session_players (session_id, user_id, display_name)
  select s_id, m.user_id, m.display_name from public.lobby_members m where m.lobby_id = p_lobby_id;

  -- Round rows retain the host's exact normalized provider track.
  for i in 1 .. jsonb_array_length(p_song_order) loop
    song_id := p_song_order->(i-1)->>'id';
    insert into public.session_rounds (session_id, round_number, song_id, track, duration_sec, started_at, end_at)
    values (s_id, i, song_id, p_song_order->(i-1), p_round_duration,
      now_ts + ((p_round_duration * (i - 1)) || ' seconds')::interval,
      now_ts + ((p_round_duration * i) || ' seconds')::interval);
  end loop;

  update public.lobbies set status = 'live' where id = p_lobby_id;

  return s_id;
end;
$$;

-- Advance to the next round (authoritative timer reset)
create or replace function public.advance_round(p_session_id uuid, p_round_duration integer default 10)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  s      public.game_sessions;
  next_r integer;
  n_rounds integer := jsonb_array_length((select song_order from public.game_sessions where id = p_session_id));
begin
  select * into s from public.game_sessions where id = p_session_id;
  next_r := s.current_round + 1;

  if next_r > n_rounds then
    update public.game_sessions set status = 'finished' where id = p_session_id;
    perform public.finalize_match(p_session_id);
    return;
  end if;

  update public.game_sessions
  set current_round = next_r,
      round_started_at = now(),
      round_end_at = now() + (p_round_duration || ' seconds')::interval
  where id = p_session_id;
end;
$$;

-- Record a player's answer for the current round and update their session stats
create or replace function public.submit_answer(
  p_session_id uuid,
  p_round_number integer,
  p_answer_id text,
  p_is_correct boolean,
  p_points integer
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.player_answers (session_id, round_number, user_id, answer_id, is_correct, points)
  values (p_session_id, p_round_number, auth.uid(), p_answer_id, p_is_correct, p_points)
  on conflict (session_id, round_number, user_id)
  do update set answer_id = excluded.answer_id, is_correct = excluded.is_correct, points = excluded.points;

  update public.session_players
  set score = score + p_points,
      streak = case when p_is_correct then streak + 1 else 0 end,
      correct = correct + case when p_is_correct then 1 else 0 end,
      asked = asked + 1
  where session_id = p_session_id and user_id = auth.uid();
end;
$$;

-- Compute and persist final match results + update lobby status
create or replace function public.finalize_match(p_session_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  l_id uuid;
  r record;
  rk  int := 1;
begin
  select lobby_id into l_id from public.game_sessions where id = p_session_id;

  for r in
    select user_id, display_name, score, correct, asked
    from public.session_players
    where session_id = p_session_id
    order by score desc
  loop
    insert into public.match_results (session_id, user_id, display_name, score, correct, asked,
      accuracy, rank)
    values (p_session_id, r.user_id, r.display_name, r.score, r.correct, r.asked,
      case when r.asked > 0 then round((r.correct::numeric / r.asked) * 100) else 0 end,
      rk);
    rk := rk + 1;
  end loop;

  update public.lobbies set status = 'finished' where id = l_id;
end;
$$;

-- Authorized-ish: only members, but answers recorded only by self (policies)
grant usage on schema public to anon, authenticated;
grant all on public.profiles to anon, authenticated;
grant all on public.lobbies to anon, authenticated;
grant all on public.lobby_members to anon, authenticated;
grant all on public.game_sessions to anon, authenticated;
grant all on public.session_rounds to anon, authenticated;
grant all on public.session_players to anon, authenticated;
grant all on public.player_answers to anon, authenticated;
grant all on public.match_results to anon, authenticated;
grant select on public.leaderboard to anon, authenticated;
grant execute on function public.is_lobby_member(uuid) to anon, authenticated;
grant execute on function public.create_lobby(text) to anon, authenticated;
grant execute on function public.join_lobby(text, text) to anon, authenticated;
grant execute on function public.set_ready(uuid, boolean) to anon, authenticated;
grant execute on function public.leave_lobby(uuid) to anon, authenticated;
grant execute on function public.start_match(uuid, jsonb, integer) to anon, authenticated;
grant execute on function public.advance_round(uuid, integer) to anon, authenticated;
grant execute on function public.submit_answer(uuid, integer, text, boolean, integer) to anon, authenticated;
grant execute on function public.finalize_match(uuid) to anon, authenticated;

-- Realtime is required for lobby readiness and live match transitions. The
-- catalog check keeps this migration safe to re-run in an existing project.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'lobbies', 'lobby_members', 'game_sessions', 'session_rounds',
    'session_players', 'player_answers', 'match_results'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
