-- Rockwell Metals system realm: durable document store for the order/vault
-- ledger (replaces data/db.json on multi-instance hosts).
--
-- One row per store. `version` is the optimistic-concurrency token: every
-- writer sends the version it read and the update only applies when it still
-- matches, so two instances can never clobber each other's orders.
--
-- Apply with: psql "$DATABASE_URL" -f supabase/migrations/20260903_rm_store.sql

create table if not exists public.rm_store (
  id          text primary key,
  version     bigint not null default 1,
  doc         jsonb  not null,
  updated_at  timestamptz not null default now()
);

-- Service-role only. No anon/authenticated policies: the storefront reaches
-- this table exclusively through the server with the service key.
alter table public.rm_store enable row level security;

comment on table public.rm_store is
  'Rockwell Metals order/vault ledger document. Written only by the storefront server (service role) with optimistic concurrency on version.';
