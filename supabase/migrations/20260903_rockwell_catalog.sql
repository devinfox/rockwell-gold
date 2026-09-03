-- Rockwell Metals catalog in the shared Supabase project.
--
-- Every Rockwell table carries the `rockwell_` prefix so the whole product
-- can be lifted out of this project with one pattern:
--
--   pg_dump "$DATABASE_URL" --schema=public --table='public.rockwell_*' > rockwell.sql
--
-- or, without database access, with the JSON round-trip scripts:
--
--   npx tsx scripts/catalog-pull.mts      # Supabase → app/data/products.json + launch-pricing.json
--   npx tsx scripts/catalog-push.mts      # app/data/*.json → Supabase (upsert)
--
-- Tables:
--   rockwell_products        one row per catalog product (typed columns + `extra` for anything new)
--   rockwell_pricing_rules   one row per product: the launch pricing rule (full rule kept as jsonb)
--   rockwell_catalog_meta    rule-book header (version, spot reference, repairs log)
--   rockwell_store           the order / vault ledger document (renamed from rm_store)
--
-- All tables are service-role only (RLS on, no policies): the storefront
-- server is the only client; the browser never talks to these tables.

-- ————— ledger: bring the earlier table under the same prefix —————
do $$
begin
  if to_regclass('public.rm_store') is not null and to_regclass('public.rockwell_store') is null then
    alter table public.rm_store rename to rockwell_store;
  end if;
end $$;

create table if not exists public.rockwell_store (
  id          text primary key,
  version     bigint not null default 1,
  doc         jsonb  not null,
  updated_at  timestamptz not null default now()
);
alter table public.rockwell_store enable row level security;

-- ————— products —————
create table if not exists public.rockwell_products (
  id                   text primary key,
  position             integer not null,              -- order in the launch catalog
  sku                  text not null,
  title                text not null,
  price                numeric(12,2),                 -- static snapshot price; null = unpriced
  price_text           text not null default '',
  badge                text not null default '',
  mint                 text not null default '',
  mint_slug            text not null default '',
  image                text not null default '',
  images               jsonb,                         -- multi-angle gallery urls
  metal                text not null,
  year                 integer,
  short_summary        text,
  full_description     text,
  metal_content        text,
  purity               text,
  grade_finish         text,
  diameter_mm          text,
  thickness_mm         text,
  face_value           text,
  ira_eligible         text,
  obverse_description  text,
  reverse_description  text,
  tags                 jsonb,
  apmex_reference_url  text,
  jm_reference_url     text,
  launch_rank          integer,
  extra                jsonb not null default '{}'::jsonb,  -- any field the app has not typed yet
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists rockwell_products_sku_idx on public.rockwell_products (sku);
create index if not exists rockwell_products_metal_idx on public.rockwell_products (metal);
create index if not exists rockwell_products_mint_slug_idx on public.rockwell_products (mint_slug);
create index if not exists rockwell_products_position_idx on public.rockwell_products (position);
alter table public.rockwell_products enable row level security;

-- ————— pricing rules —————
create table if not exists public.rockwell_pricing_rules (
  id            text primary key references public.rockwell_products (id) on delete cascade,
  sku           text not null,
  pricing_type  text not null,
  live          boolean not null default false,
  needs_review  boolean not null default false,
  rule          jsonb not null,                      -- the full LaunchRule
  updated_at    timestamptz not null default now()
);
create index if not exists rockwell_pricing_rules_live_idx on public.rockwell_pricing_rules (live);
alter table public.rockwell_pricing_rules enable row level security;

-- ————— rule-book header —————
create table if not exists public.rockwell_catalog_meta (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.rockwell_catalog_meta enable row level security;

comment on table public.rockwell_products is 'Rockwell Metals launch catalog. Source of truth; the storefront pulls a JSON snapshot at build (scripts/catalog-pull.mts).';
comment on table public.rockwell_pricing_rules is 'Rockwell Metals competitor-calibrated pricing rule per product (app/lib/pricing/launch-rules.ts shape in `rule`).';
comment on table public.rockwell_catalog_meta is 'Rockwell Metals catalog metadata: launch-pricing header (version, spotReference, repairs).';
comment on table public.rockwell_store is 'Rockwell Metals order/vault ledger document; optimistic concurrency on version.';
