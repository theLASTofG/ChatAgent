-- ===========================================================================
-- ProjetoIA — schema Supabase (PostgreSQL)
-- Execute no SQL Editor do Supabase (Project → SQL Editor → New query).
-- É idempotente: pode rodar de novo sem quebrar o que já existe.
--
-- Princípios:
--   * RLS ligado em TODAS as tabelas: cada usuário só enxerga as próprias linhas.
--   * O admin NÃO lê conteúdo clínico nem perfis individuais: só totais agregados
--     via função admin_usage_totals().
--   * clinical_sessions guarda apenas texto cifrado no navegador (AES-GCM); o
--     servidor e o banco nunca recebem a chave nem o texto em claro.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles: 1 linha por usuário de auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text,
  email       text,
  role        text not null default 'user' check (role in ('user', 'admin')),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: ler o próprio" on public.profiles;
create policy "profiles: ler o próprio" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "profiles: editar o próprio" on public.profiles;
create policy "profiles: editar o próprio" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- O usuário só pode mudar o próprio nome: role e email ficam fora do alcance
-- (impede auto-promoção a admin). Inserts vêm só do gatilho abaixo.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. usage_counters: métricas agregadas, sem conteúdo clínico
-- ---------------------------------------------------------------------------
create table if not exists public.usage_counters (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  total_chats           bigint not null default 0 check (total_chats >= 0),
  clinical_notes_count  bigint not null default 0 check (clinical_notes_count >= 0),
  tokens_estimated      bigint not null default 0 check (tokens_estimated >= 0),
  last_active           timestamptz not null default now()
);

alter table public.usage_counters enable row level security;

drop policy if exists "usage: ler o próprio" on public.usage_counters;
create policy "usage: ler o próprio" on public.usage_counters
  for select to authenticated using (user_id = (select auth.uid()));

-- Escrita só pelas funções bump_usage/touch_usage (security definer), que
-- limitam os incrementos: o cliente não consegue zerar nem inflar à vontade.
revoke insert, update, delete on public.usage_counters from anon, authenticated;
grant select on public.usage_counters to authenticated;

-- ---------------------------------------------------------------------------
-- 3. clinical_sessions: backup opcional e CIFRADO das conversas
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  thread_id   text not null,                 -- id local da conversa (localStorage)
  ciphertext  text not null,                 -- base64 do JSON cifrado com AES-GCM no navegador
  iv          text not null,                 -- base64 do vetor de inicialização (12 bytes)
  key_hint    text,                          -- opcional: identifica a chave usada, nunca a chave
  version     int  not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, thread_id)
);

create index if not exists clinical_sessions_user_updated_idx
  on public.clinical_sessions (user_id, updated_at desc);

alter table public.clinical_sessions enable row level security;

drop policy if exists "sessions: dono lê" on public.clinical_sessions;
create policy "sessions: dono lê" on public.clinical_sessions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "sessions: dono cria" on public.clinical_sessions;
create policy "sessions: dono cria" on public.clinical_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "sessions: dono edita" on public.clinical_sessions;
create policy "sessions: dono edita" on public.clinical_sessions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "sessions: dono apaga" on public.clinical_sessions;
create policy "sessions: dono apaga" on public.clinical_sessions
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.clinical_sessions from anon;
grant select, insert, update, delete on public.clinical_sessions to authenticated;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists clinical_sessions_updated_at on public.clinical_sessions;
create trigger clinical_sessions_updated_at before update on public.clinical_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Gatilho: novo usuário (Google) → cria perfil e contadores
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  insert into public.usage_counters (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 5. RPCs de contadores (chamadas por public/auth.js)
-- ---------------------------------------------------------------------------
create or replace function public.bump_usage(p_chats int default 0, p_clinical_notes int default 0, p_tokens int default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'não autenticado'; end if;
  -- Limites por chamada: protege contra inflar métricas em massa
  p_chats          := least(greatest(coalesce(p_chats, 0), 0), 1);
  p_clinical_notes := least(greatest(coalesce(p_clinical_notes, 0), 0), 1);
  p_tokens         := least(greatest(coalesce(p_tokens, 0), 0), 200000);
  insert into public.usage_counters as u (user_id, total_chats, clinical_notes_count, tokens_estimated, last_active)
  values (uid, p_chats, p_clinical_notes, p_tokens, now())
  on conflict (user_id) do update set
    total_chats          = u.total_chats + excluded.total_chats,
    clinical_notes_count = u.clinical_notes_count + excluded.clinical_notes_count,
    tokens_estimated     = u.tokens_estimated + excluded.tokens_estimated,
    last_active          = now();
end $$;

create or replace function public.touch_usage() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.usage_counters (user_id) values (auth.uid())
  on conflict (user_id) do update set last_active = now();
end $$;

-- ---------------------------------------------------------------------------
-- 6. Visão do admin: SÓ totais agregados (nenhuma linha individual)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.admin_usage_totals()
returns table (
  total_users bigint, active_last_7d bigint, active_last_30d bigint,
  total_chats bigint, clinical_notes bigint, tokens_estimated bigint, backed_up_sessions bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'acesso restrito ao admin'; end if;
  return query
    select
      (select count(*) from public.profiles),
      count(*) filter (where c.last_active > now() - interval '7 days'),
      count(*) filter (where c.last_active > now() - interval '30 days'),
      coalesce(sum(c.total_chats), 0)::bigint,
      coalesce(sum(c.clinical_notes_count), 0)::bigint,
      coalesce(sum(c.tokens_estimated), 0)::bigint,
      (select count(*) from public.clinical_sessions)
    from public.usage_counters c;
end $$;

-- Funções expostas só para usuários logados
revoke execute on function public.bump_usage(int, int, int), public.touch_usage(), public.is_admin(), public.admin_usage_totals() from public, anon;
grant execute on function public.bump_usage(int, int, int), public.touch_usage(), public.is_admin(), public.admin_usage_totals() to authenticated;
revoke execute on function public.handle_new_user(), public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Promover o primeiro admin (rode à mão, trocando o e-mail):
--   update public.profiles set role = 'admin' where email = 'voce@exemplo.com';
-- ---------------------------------------------------------------------------
