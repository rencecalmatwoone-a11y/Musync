alter table public.session_rounds
  add column if not exists track jsonb not null default '{}'::jsonb;

drop function if exists public.start_match(uuid, jsonb, integer);
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
  s_id uuid := gen_random_uuid();
  members int;
  ready_members int;
  unique_songs int;
  now_ts timestamptz := now();
  i int;
  selected_track jsonb;
begin
  if not exists (select 1 from public.lobbies where id = p_lobby_id and host_id = auth.uid() and status = 'lobby') then raise exception 'ONLY_HOST_CAN_START'; end if;
  select count(*), count(*) filter (where ready) into members, ready_members from public.lobby_members where lobby_id = p_lobby_id;
  if members < 2 then raise exception 'NOT_ENOUGH_PLAYERS'; end if;
  if ready_members <> members then raise exception 'PLAYERS_NOT_READY'; end if;
  if jsonb_typeof(p_song_order) <> 'array' or jsonb_array_length(p_song_order) <> 10 then raise exception 'INVALID_SONG_ORDER'; end if;
  select count(distinct track->>'id') into unique_songs from jsonb_array_elements(p_song_order) as item(track);
  if unique_songs <> 10 or exists (select 1 from jsonb_array_elements(p_song_order) as item(track) where jsonb_typeof(item.track) <> 'object' or nullif(trim(item.track->>'id'), '') is null) then raise exception 'INVALID_SONG_ORDER'; end if;
  insert into public.game_sessions (id, lobby_id, song_order, current_round, status, round_started_at, round_end_at) values (s_id, p_lobby_id, p_song_order, 1, 'live', now_ts, now_ts + (p_round_duration || ' seconds')::interval);
  insert into public.session_players (session_id, user_id, display_name) select s_id, m.user_id, m.display_name from public.lobby_members m where m.lobby_id = p_lobby_id;
  for i in 1 .. 10 loop
    selected_track := p_song_order->(i-1);
    insert into public.session_rounds (session_id, round_number, song_id, track, duration_sec, started_at, end_at) values (s_id, i, selected_track->>'id', selected_track, p_round_duration, now_ts + ((p_round_duration * (i - 1)) || ' seconds')::interval, now_ts + ((p_round_duration * i) || ' seconds')::interval);
  end loop;
  update public.lobbies set status = 'live' where id = p_lobby_id;
  return s_id;
end;
$$;
grant execute on function public.start_match(uuid, jsonb, integer) to anon, authenticated;