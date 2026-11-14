-- Общая анонимная статистика «Тот, кто остался» (Supabase / Postgres).
-- Игрок = случайный UUID из браузера, без личных данных. Таблицы закрыты RLS без политик:
-- клиент (publishable/anon key) работает только через функции ниже (SECURITY DEFINER).

create table if not exists public.qq_events (
  player uuid not null,
  kind   text not null check (kind in ('start','death','final','choice')),
  key    text not null check (length(key) <= 80),
  at     timestamptz not null default now(),
  primary key (player, kind, key)
);
create table if not exists public.qq_progress (
  player uuid primary key,
  scene  text not null check (length(scene) <= 40),
  at     timestamptz not null default now()
);
create table if not exists public.qq_finals (
  player uuid not null,
  final  text not null check (length(final) <= 40),
  lives  int  not null check (lives between 0 and 1000),
  deaths int  not null check (deaths between 0 and 100000),
  primary key (player, final)
);
create table if not exists public.qq_counters (
  key text primary key,
  n   bigint not null default 0
);
alter table public.qq_events   enable row level security;
alter table public.qq_progress enable row level security;
alter table public.qq_finals   enable row level security;
alter table public.qq_counters enable row level security;
create index if not exists qq_events_kind_key on public.qq_events (kind, key);

-- событие игрока: одна отметка на (игрок, вид, ключ); каждая смерть ещё и в общий счётчик Хора
create or replace function public.qq_hit(p uuid, k text, key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into qq_events(player, kind, key) values (p, k, left(key, 80)) on conflict do nothing;
  if k = 'death' then
    insert into qq_counters(key, n) values ('deaths', 1) on conflict (key) do update set n = qq_counters.n + 1;
  end if;
end $$;

create or replace function public.qq_seen(p uuid, scene text)
returns void language sql security definer set search_path = public as $$
  insert into qq_progress(player, scene) values (p, left(scene, 40))
  on conflict (player) do update set scene = excluded.scene, at = now();
$$;

create or replace function public.qq_final(p uuid, f text, lives int, deaths int)
returns void language sql security definer set search_path = public as $$
  insert into qq_finals(player, final, lives, deaths) values (p, left(f, 40), greatest(0, least(lives, 1000)), greatest(0, least(deaths, 100000)))
  on conflict do nothing;
$$;

-- сколько игроков получили каждый ключ из списка; total — всего игроков
create or replace function public.qq_counts(k text, keys text[])
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'total', (select count(*) from qq_events where kind = 'start'),
    'n', coalesce((select json_object_agg(key, c) from (
      select key, count(*) c from qq_events where kind = k and key = any(keys) group by key) t), '{}'::json));
$$;

-- раскладка выборов в сцене: ключи 'Сцена/ID'
create or replace function public.qq_split(scene text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(key, c), '{}'::json) from (
    select key, count(*) c from qq_events where kind = 'choice' and key like scene || '/%' group by key) t;
$$;

create or replace function public.qq_final_stats(f text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'total', (select count(*) from qq_events where kind = 'start'),
    'n', (select count(*) from qq_finals where final = f),
    'lives', (select round(avg(lives)::numeric, 1) from qq_finals where final = f),
    'deaths', (select round(avg(deaths)::numeric, 0) from qq_finals where final = f));
$$;

create or replace function public.qq_chorus()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'deaths', coalesce((select n from qq_counters where key = 'deaths'), 0),
    'players', (select count(*) from qq_events where kind = 'start'));
$$;

-- для автора: где бросают (последняя сцена тех, кого не было 3+ дня), редкие выборы, финалы
create or replace function public.qq_admin()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'players', (select count(*) from qq_events where kind = 'start'),
    'dropoff', coalesce((select json_agg(t) from (
      select scene, count(*) n from qq_progress where at < now() - interval '3 days'
      group by scene order by n desc limit 25) t), '[]'::json),
    'choices', coalesce((select json_agg(t) from (
      select key, count(*) n from qq_events where kind = 'choice' group by key order by n asc limit 40) t), '[]'::json),
    'finals', coalesce((select json_agg(t) from (
      select final, count(*) n, round(avg(lives)::numeric,1) lives, round(avg(deaths)::numeric,0) deaths
      from qq_finals group by final order by n desc) t), '[]'::json),
    'deaths', coalesce((select json_agg(t) from (
      select key, count(*) n from qq_events where kind = 'death' group by key order by n desc) t), '[]'::json));
$$;

revoke all on function public.qq_hit, public.qq_seen, public.qq_final, public.qq_counts, public.qq_split,
  public.qq_final_stats, public.qq_chorus, public.qq_admin from public;
grant execute on function public.qq_hit, public.qq_seen, public.qq_final, public.qq_counts, public.qq_split,
  public.qq_final_stats, public.qq_chorus, public.qq_admin to anon, authenticated;
