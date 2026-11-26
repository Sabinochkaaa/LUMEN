-- LÜMEN: вся база одним запуском. Supabase → SQL Editor → вставить файл целиком → Run.
-- Можно запускать повторно: ничего не сломает и не удалит.

-- LÜMEN Requirements Intelligence — история прогонов в Supabase (Postgres).
-- Выполните в Supabase → SQL Editor. Доступ только сервисным ключом backend (RLS включён, политик для anon нет).
create table if not exists public.audits (
  id              text primary key,
  document_name   text not null,
  document_title  text,
  analysed_at     timestamptz not null,
  model           text,
  provider        text,
  mode            text,
  readiness       text,
  quality_index   numeric,
  requirements    int,
  findings        int,
  critical        int,
  high            int,
  questions       int,
  open_questions  int,
  demo            boolean default false,
  duration_s      numeric,
  private         boolean default false,
  result          jsonb not null,
  created_at      timestamptz default now()
);
create index if not exists audits_analysed_at_idx on public.audits (analysed_at desc);
alter table public.audits enable row level security;
grant all on public.audits to service_role;

-- LÜMEN: приватные прогоны (документы из Telegram-бота не попадают в публичный список).
-- Выполните в Supabase → SQL Editor после 001_audits.sql.
alter table public.audits add column if not exists private boolean default false;
create index if not exists audits_private_idx on public.audits (private);
-- Доступ только сервисным ключом backend: RLS включён, политик для anon/authenticated нет.
alter table public.audits enable row level security;
revoke all on public.audits from anon, authenticated;
grant all on public.audits to service_role;

-- LÜMEN: обращения в поддержку («Передать команде»), чтобы они не пропадали при перезапуске сервера.
-- Выполните в Supabase → SQL Editor после 002_security.sql. Доступ только у сервера (секретный ключ).
create table if not exists public.support_tickets (
  id        text primary key,
  at        timestamptz not null default now(),
  channel   text not null default 'site',
  message   text not null,
  contact   text,
  audit_id  text,
  history   jsonb not null default '[]'::jsonb,
  status    text not null default 'new'
);
create index if not exists support_tickets_at_idx on public.support_tickets (at desc);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from anon, authenticated;
grant all on public.support_tickets to service_role;
