-- =====================================================================
-- Controle Financeiro · esquema do banco (Supabase / PostgreSQL)
--
-- Como aplicar: cole este arquivo inteiro no SQL Editor do painel do
-- Supabase e clique em Run. Pode rodar de novo sem problema (idempotente).
--
-- Modelo de acesso:
--   * Cada pessoa só enxerga e altera os PRÓPRIOS dados (RLS por user_id).
--   * Só contas ativas (profiles.active = true) leem ou gravam dados.
--   * O administrador gerencia contas pela Edge Function "admin-users",
--     que usa a service_role no servidor. O admin NÃO lê lançamentos de
--     outros usuários.
--   * Ninguém cria o próprio perfil: perfis só nascem pela Edge Function.
--     Assim, mesmo que o cadastro público do Auth esteja ligado, quem se
--     cadastrar por fora não tem perfil e não acessa nada.
-- =====================================================================

-- Funções auxiliares ficam num schema que a API REST não expõe.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

-- Um perfil por conta do Supabase Auth. "username" é o login digitado.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name text not null default '' check (char_length(display_name) <= 80),
  role         text not null default 'user' check (role in ('admin', 'user')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null
);

-- Preferências de cada usuário (saldo inicial e tema).
create table if not exists public.user_settings (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  opening_balance numeric(14, 2) not null default 0
                    check (abs(opening_balance) <= 100000000000),
  theme           text not null default 'auto' check (theme in ('auto', 'light', 'dark'))
);

-- Lançamentos (entradas e saídas). "recurring" = repete todo mês.
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type        text not null check (type in ('in', 'out')),
  description text not null default '' check (char_length(description) <= 80),
  amount      numeric(14, 2) not null check (amount > 0 and amount <= 100000000000),
  category    text not null default 'Outros' check (char_length(category) between 1 and 40),
  occurred_on date not null,
  recurring   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists transactions_user_date_idx
  on public.transactions (user_id, occurred_on);

-- Limite mensal por categoria de saída.
create table if not exists public.budgets (
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null check (char_length(category) between 1 and 40),
  amount   numeric(14, 2) not null check (amount > 0 and amount <= 100000000000),
  primary key (user_id, category)
);

-- ---------------------------------------------------------------------
-- Funções auxiliares (usadas pelas políticas)
-- ---------------------------------------------------------------------
create or replace function app_private.is_active_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
  );
$$;

create or replace function app_private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active and p.role = 'admin'
  );
$$;

revoke all on function app_private.is_active_user() from public;
revoke all on function app_private.is_admin() from public;
grant execute on function app_private.is_active_user() to authenticated;
grant execute on function app_private.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Permissões de tabela + RLS
-- ---------------------------------------------------------------------
revoke all on table public.profiles, public.user_settings,
                    public.transactions, public.budgets from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table public.user_settings,
                    public.transactions, public.budgets to authenticated;

alter table public.profiles      enable row level security;
alter table public.user_settings enable row level security;
alter table public.transactions  enable row level security;
alter table public.budgets       enable row level security;

-- profiles: cada um lê o próprio; admin lê todos. Sem escrita pela API.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select app_private.is_admin()));

-- dados do usuário: só o dono, e só enquanto a conta estiver ativa.
drop policy if exists user_settings_own on public.user_settings;
create policy user_settings_own on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()) and (select app_private.is_active_user()))
  with check (user_id = (select auth.uid()) and (select app_private.is_active_user()));

drop policy if exists transactions_own on public.transactions;
create policy transactions_own on public.transactions
  for all to authenticated
  using (user_id = (select auth.uid()) and (select app_private.is_active_user()))
  with check (user_id = (select auth.uid()) and (select app_private.is_active_user()));

drop policy if exists budgets_own on public.budgets;
create policy budgets_own on public.budgets
  for all to authenticated
  using (user_id = (select auth.uid()) and (select app_private.is_active_user()))
  with check (user_id = (select auth.uid()) and (select app_private.is_active_user()));

-- ---------------------------------------------------------------------
-- Substituir todos os dados do usuário de uma vez (restaurar backup,
-- importar planilha em modo "substituir", dados de exemplo, apagar tudo).
-- É "security invoker": as políticas acima continuam valendo, e a
-- operação é atômica (ou grava tudo, ou nada).
-- ---------------------------------------------------------------------
create or replace function public.replace_my_data(
  p_transactions jsonb,
  p_budgets      jsonb,
  p_opening      numeric,
  p_theme        text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'não autenticado' using errcode = '28000';
  end if;

  delete from public.transactions where user_id = v_uid;
  delete from public.budgets where user_id = v_uid;

  insert into public.transactions
    (id, user_id, type, description, amount, category, occurred_on, recurring)
  select (t ->> 'id')::uuid,
         v_uid,
         t ->> 'type',
         coalesce(t ->> 'description', ''),
         (t ->> 'amount')::numeric,
         coalesce(nullif(t ->> 'category', ''), 'Outros'),
         (t ->> 'occurred_on')::date,
         coalesce((t ->> 'recurring')::boolean, false)
  from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb)) as t;

  insert into public.budgets (user_id, category, amount)
  select v_uid, b.key, b.value::numeric
  from jsonb_each_text(coalesce(p_budgets, '{}'::jsonb)) as b
  where b.value::numeric > 0;

  insert into public.user_settings (user_id, opening_balance, theme)
  values (
    v_uid,
    coalesce(p_opening, 0),
    case when p_theme in ('auto', 'light', 'dark') then p_theme else 'auto' end
  )
  on conflict (user_id) do update
    set opening_balance = excluded.opening_balance,
        theme           = excluded.theme;
end;
$$;

revoke all on function public.replace_my_data(jsonb, jsonb, numeric, text) from public, anon;
grant execute on function public.replace_my_data(jsonb, jsonb, numeric, text) to authenticated;
