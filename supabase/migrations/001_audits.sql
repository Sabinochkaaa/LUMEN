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
