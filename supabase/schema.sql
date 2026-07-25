-- Tip Tap Games — full backend schema.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Safe to re-run: everything is create-if-not-exists / create-or-replace.
--
-- Design notes:
--   * The client NEVER writes to `scores` directly. RLS denies it. The only way in
--     is submit_score(), a security-definer function that validates server-side.
--   * A "leaderboard identity" is the signed-in player if there is one, otherwise
--     the guest device. That lets guests appear on the board from the first run
--     and makes the merge on sign-in a pure relabelling.
--   * player_id is taken from auth.uid(), never from the client.

-- ---------------------------------------------------------------- tables

create table if not exists public.players (
  id          uuid primary key references auth.users(id) on delete cascade,
  handle      text not null,
  avatar_url  text,
  provider    text check (provider in ('google', 'discord')),
  device_id   uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.games (
  slug       text primary key,
  title      text not null,
  rule_text  text,
  is_active  boolean not null default true,
  -- server-side sanity bounds; see submit_score()
  max_score  integer not null default 100000,
  max_rate   numeric                      -- max plausible points per second
);

create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  player_id   uuid references public.players(id) on delete cascade,
  device_id   uuid not null,
  game_slug   text not null references public.games(slug),
  score       integer not null check (score >= 0),
  duration_ms integer,
  created_at  timestamptz not null default now()
);

create index if not exists scores_board_idx  on public.scores (game_slug, score desc);
create index if not exists scores_player_idx on public.scores (player_id, game_slug);
create index if not exists scores_claim_idx  on public.scores (device_id) where player_id is null;
create index if not exists scores_recent_idx on public.scores (device_id, created_at desc);

-- ---------------------------------------------------------------- seed games
-- max_rate is the ceiling on points-per-second. Tuned per mechanic so a console
-- cheat has to at least respect wall-clock time.

insert into public.games (slug, title, rule_text, max_score, max_rate) values
  ('hardwater', 'Hardwater', 'Walk the ice. Crank the reel. Ease off when it runs.', 5000, 6),
  ('keeper',    'Keeper',    'Tap a side to dive. Stay put for the middle.',         1000, 1.5),
  ('fit',       'Fit',       'Drag to rotate. Match the hole.',                        2000, 3),
  ('lock',      'Lock',      'Tap when the rings meet.',                               2000, 2.5)
on conflict (slug) do update
  set title = excluded.title,
      rule_text = excluded.rule_text,
      max_score = excluded.max_score,
      max_rate = excluded.max_rate;

-- ---------------------------------------------------------------- rls

alter table public.players enable row level security;
alter table public.games   enable row level security;
alter table public.scores  enable row level security;

drop policy if exists players_read      on public.players;
drop policy if exists players_write_self on public.players;
drop policy if exists games_read        on public.games;
drop policy if exists scores_read       on public.scores;

-- handles and avatars are shown on the board, so they're public
create policy players_read on public.players for select using (true);
create policy players_write_self on public.players for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy games_read on public.games for select using (is_active);

-- board is public to read; there is deliberately no insert/update policy,
-- so the only write path is submit_score() below
create policy scores_read on public.scores for select using (true);

-- ---------------------------------------------------------------- helpers

-- The identity a row competes under: the account if signed in, else the device.
create or replace function public.score_identity(p_player uuid, p_device uuid)
returns text language sql immutable as $$
  select coalesce(p_player::text, 'device:' || p_device::text);
$$;

-- ---------------------------------------------------------------- standing

-- best / rank / total / percentile for one identity in one game
create or replace function public.my_standing(p_game_slug text, p_device_id uuid default null)
returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me    text := public.score_identity(auth.uid(), p_device_id);
  v_best  integer;
  v_rank  integer;
  v_total integer;
  v_below integer;
begin
  with bests as (
    select public.score_identity(player_id, device_id) as identity, max(score) as best
    from scores where game_slug = p_game_slug group by 1
  )
  select
    (select best from bests where identity = v_me),
    (select count(*) from bests),
    (select count(*) from bests b
      where b.best < coalesce((select best from bests where identity = v_me), -1))
  into v_best, v_total, v_below;

  if v_best is null then
    return json_build_object('best', null, 'rank', null, 'total', v_total, 'percentile', null);
  end if;

  select count(*) + 1 into v_rank
  from (select public.score_identity(player_id, device_id) as identity, max(score) as best
        from scores where game_slug = p_game_slug group by 1) b
  where b.best > v_best;

  return json_build_object(
    'best', v_best,
    'rank', v_rank,
    'total', v_total,
    'percentile', case when v_total > 1
      then round((v_below::numeric / (v_total - 1)) * 100)
      else null end
  );
end $$;

-- ---------------------------------------------------------------- submit

create or replace function public.submit_score(
  p_device_id   uuid,
  p_game_slug   text,
  p_score       integer,
  p_duration_ms integer default null
) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g       record;
  v_recent integer;
begin
  if p_device_id is null then
    raise exception 'device_id required';
  end if;

  select * into g from games where slug = p_game_slug and is_active;
  if not found then
    raise exception 'unknown game %', p_game_slug using errcode = '22023';
  end if;

  -- bounds
  if p_score is null or p_score < 0 or p_score > g.max_score then
    raise exception 'score out of range' using errcode = '22023';
  end if;

  -- rate plausibility: you cannot score faster than the mechanic allows
  if g.max_rate is not null and p_duration_ms is not null and p_duration_ms > 250 then
    if p_score::numeric / (p_duration_ms / 1000.0) > g.max_rate then
      raise exception 'score rate implausible' using errcode = '22023';
    end if;
  end if;

  -- flood guard, per device
  select count(*) into v_recent
  from scores
  where device_id = p_device_id and created_at > now() - interval '1 minute';
  if v_recent >= 20 then
    -- PostgREST maps a PTnnn sqlstate straight to that HTTP status, so a flood
    -- reads as 429 rather than masquerading as a server error
    raise exception 'too many submissions' using errcode = 'PT429';
  end if;

  insert into scores (player_id, device_id, game_slug, score, duration_ms)
  values (auth.uid(), p_device_id, p_game_slug, p_score, p_duration_ms);

  return public.my_standing(p_game_slug, p_device_id);
end $$;

-- ---------------------------------------------------------------- board

create or replace function public.leaderboard(
  p_game_slug text,
  p_device_id uuid default null,
  p_limit     integer default 10
) returns table (rnk bigint, handle text, avatar_url text, best integer, is_me boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with bests as (
    select public.score_identity(s.player_id, s.device_id) as identity,
           max(s.score) as best
    from scores s
    where s.game_slug = p_game_slug
    group by 1
  ), ranked as (
    select b.identity, b.best,
           rank() over (order by b.best desc) as rnk
    from bests b
  )
  select r.rnk,
         coalesce(p.handle, 'guest') as handle,
         p.avatar_url,
         r.best,
         r.identity = public.score_identity(auth.uid(), p_device_id) as is_me
  from ranked r
  left join players p on p.id::text = r.identity
  order by r.rnk asc, r.identity asc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

-- ---------------------------------------------------------------- sign-in

-- Create/refresh the players row from the OAuth metadata. Called right after
-- sign-in. Handle and avatar come free from Discord and Google.
create or replace function public.ensure_player(p_device_id uuid default null)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u          record;
  v_handle   text;
  v_avatar   text;
  v_provider text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select raw_user_meta_data as meta, raw_app_meta_data as app
    into u from auth.users where id = auth.uid();

  -- discord puts the handle in user_name; google only gives a display name
  v_handle := coalesce(
    u.meta ->> 'user_name',
    u.meta ->> 'preferred_username',
    u.meta -> 'custom_claims' ->> 'global_name',
    u.meta ->> 'name',
    u.meta ->> 'full_name',
    'player'
  );
  v_avatar   := coalesce(u.meta ->> 'avatar_url', u.meta ->> 'picture');
  v_provider := u.app ->> 'provider';

  insert into players (id, handle, avatar_url, provider, device_id)
  values (auth.uid(), v_handle, v_avatar, v_provider, p_device_id)
  on conflict (id) do update
    set handle     = excluded.handle,
        avatar_url = excluded.avatar_url,
        provider   = excluded.provider,
        device_id  = coalesce(excluded.device_id, players.device_id);

  return json_build_object(
    'id', auth.uid(), 'handle', v_handle,
    'avatar_url', v_avatar, 'provider', v_provider
  );
end $$;

-- Reattach every guest run from this device to the account. Nobody loses a run.
create or replace function public.claim_device_scores(p_device_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_device_id is null then
    return 0;
  end if;

  update scores
     set player_id = auth.uid()
   where device_id = p_device_id
     and player_id is null;

  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- grants

revoke all on function public.submit_score(uuid, text, integer, integer)  from public;
revoke all on function public.claim_device_scores(uuid)                    from public;
revoke all on function public.ensure_player(uuid)                          from public;

grant execute on function public.submit_score(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.my_standing(text, uuid)                    to anon, authenticated;
grant execute on function public.leaderboard(text, uuid, integer)           to anon, authenticated;
grant execute on function public.ensure_player(uuid)                        to authenticated;
grant execute on function public.claim_device_scores(uuid)                  to authenticated;
