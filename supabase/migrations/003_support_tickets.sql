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
