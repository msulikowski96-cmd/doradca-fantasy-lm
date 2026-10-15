-- Konta, stan aplikacji w chmurze, wspólne dane gry i wspólny klucz AI (tylko serwer).

create type public.app_role as enum ('user', 'admin');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null default '',
  display_name text not null default '' check (char_length(display_name) <= 40),
  role public.app_role not null default 'user',
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.user_states (
  user_id uuid primary key references public.profiles on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Jeden wiersz: terminarz i godziny kolejek ustawiane przez admina (np. z SofaScore).
create table public.game_data (
  id int primary key default 1 check (id = 1),
  fixtures jsonb not null default '{}'::jsonb,
  rounds jsonb,
  source text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles on delete set null
);
insert into public.game_data (id) values (1);

-- Jeden wiersz: wspólny klucz AI. Bez polityk RLS – czytają go tylko funkcje security definer
-- i funkcja brzegowa (service role). Klient nigdy nie dostaje klucza.
create table public.ai_config (
  id int primary key default 1 check (id = 1),
  provider text not null default 'gemini' check (provider in ('gemini', 'anthropic')),
  model text not null default 'gemini-3.8-flash',
  api_key text not null default '',
  daily_limit int not null default 5 check (daily_limit between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.ai_config (id) values (1);

create table public.ai_usage (
  user_id uuid not null references public.profiles on delete cascade,
  day date not null default (now() at time zone 'Europe/Warsaw')::date,
  count int not null default 0,
  primary key (user_id, day)
);

alter table public.profiles enable row level security;
alter table public.user_states enable row level security;
alter table public.game_data enable row level security;
alter table public.ai_config enable row level security;
alter table public.ai_usage enable row level security;

-- Pomocnicze: aktywne konto i admin (security definer, żeby polityki nie odpytywały się rekurencyjnie).
create function public.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and not blocked);
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and not blocked);
$$;

revoke execute on function public.is_active() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_active() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- profiles: każdy widzi swój profil, admin wszystkie. Zmiany ról i blokad tylko admin (trigger niżej).
create policy "profiles: odczyt własnego lub admin" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: edycja własnego lub admin" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

-- (Wersja z security definer – poprawiona w 20261015112241_fix_protect_profile_invoker.sql.)
create function public.protect_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.role is distinct from old.role or new.blocked is distinct from old.blocked
      or new.email is distinct from old.email or new.id is distinct from old.id)
     and not public.is_admin() and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Tylko admin może zmieniać role i blokady kont.';
  end if;
  -- Admin nie odbierze sam sobie roli ani nie zablokuje siebie (żeby nie zostać bez admina).
  if new.id = (select auth.uid()) and old.role = 'admin' and (new.role <> 'admin' or new.blocked) then
    raise exception 'Nie możesz odebrać roli admina ani zablokować własnego konta.';
  end if;
  return new;
end $$;
create trigger protect_profile before update on public.profiles
  for each row execute function public.protect_profile();

-- user_states: właściciel (aktywny) czyta i zapisuje swój stan; admin tylko czyta wszystkie.
create policy "user_states: odczyt własnego lub admin" on public.user_states
  for select to authenticated
  using ((user_id = (select auth.uid()) and (select public.is_active())) or (select public.is_admin()));
create policy "user_states: wstawianie własnego" on public.user_states
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_active()));
create policy "user_states: edycja własnego" on public.user_states
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active()))
  with check (user_id = (select auth.uid()) and (select public.is_active()));

-- game_data: czytają wszyscy zalogowani (aktywni), zmienia admin.
create policy "game_data: odczyt" on public.game_data
  for select to authenticated using ((select public.is_active()));
create policy "game_data: edycja admin" on public.game_data
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ai_usage: własne zużycie albo admin. Zapisy tylko przez funkcję brzegową (service role).
create policy "ai_usage: odczyt własnego lub admin" on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Nowe konto -> profil (nazwa z formularza rejestracji).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''),
          left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 40));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Ustawienia AI widoczne dla zalogowanych – bez klucza (tylko czy jest ustawiony i jego końcówka dla admina).
create function public.get_ai_config() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'provider', c.provider, 'model', c.model, 'daily_limit', c.daily_limit,
    'key_set', c.api_key <> '',
    'key_hint', case when public.is_admin() and c.api_key <> '' then '…' || right(c.api_key, 4) else null end,
    'used_today', coalesce((select u.count from public.ai_usage u
                            where u.user_id = (select auth.uid()) and u.day = (now() at time zone 'Europe/Warsaw')::date), 0))
  from public.ai_config c where c.id = 1 and public.is_active();
$$;

-- Zmiana wspólnych ustawień AI – tylko admin. Pusty klucz = zostaw obecny.
create function public.set_ai_config(p_provider text, p_model text, p_api_key text, p_daily_limit int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Tylko admin może zmieniać wspólny klucz AI.'; end if;
  update public.ai_config set
    provider = p_provider,
    model = p_model,
    api_key = case when coalesce(p_api_key, '') = '' then api_key else p_api_key end,
    daily_limit = p_daily_limit,
    updated_at = now()
  where id = 1;
end $$;

create function public.clear_ai_key() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Tylko admin może usunąć wspólny klucz AI.'; end if;
  update public.ai_config set api_key = '', updated_at = now() where id = 1;
end $$;

revoke execute on function public.get_ai_config() from public, anon;
revoke execute on function public.set_ai_config(text, text, text, int) from public, anon;
revoke execute on function public.clear_ai_key() from public, anon;
grant execute on function public.get_ai_config() to authenticated;
grant execute on function public.set_ai_config(text, text, text, int) to authenticated;
grant execute on function public.clear_ai_key() to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.protect_profile() from public, anon, authenticated;

-- Licznik użycia AI: wywołuje tylko funkcja brzegowa (service role).
create function public.bump_ai_usage(p_user uuid) returns int
language sql security definer set search_path = '' as $$
  insert into public.ai_usage (user_id, day, count)
  values (p_user, (now() at time zone 'Europe/Warsaw')::date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count;
$$;
revoke execute on function public.bump_ai_usage(uuid) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid) to service_role;
