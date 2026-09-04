-- Fix lobby visibility for authenticated and anonymous members.
-- Run this once in Supabase SQL Editor for an existing project.
create or replace function public.is_lobby_member(p_lobby_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.lobby_members
    where lobby_id = p_lobby_id and user_id = auth.uid()
  )
$$;

drop policy if exists "lobbies_select" on public.lobbies;
create policy "lobbies_select" on public.lobbies
  for select using (public.is_lobby_member(id));

drop policy if exists "members_select" on public.lobby_members;
create policy "members_select" on public.lobby_members
  for select using (public.is_lobby_member(lobby_id));

grant execute on function public.is_lobby_member(uuid) to anon, authenticated;
