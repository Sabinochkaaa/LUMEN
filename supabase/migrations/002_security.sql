-- LÜMEN: приватные прогоны (документы из Telegram-бота не попадают в публичный список).
-- Выполните в Supabase → SQL Editor после 001_audits.sql.
alter table public.audits add column if not exists private boolean default false;
create index if not exists audits_private_idx on public.audits (private);
-- Доступ только сервисным ключом backend: RLS включён, политик для anon/authenticated нет.
alter table public.audits enable row level security;
revoke all on public.audits from anon, authenticated;
grant all on public.audits to service_role;
