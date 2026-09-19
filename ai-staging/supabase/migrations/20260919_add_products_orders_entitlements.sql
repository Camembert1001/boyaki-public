create table if not exists public.ai_staging_boyaki_products (
  id uuid primary key default gen_random_uuid(),
  solution_case_id uuid not null unique references public.ai_staging_boyaki_solution_cases(id) on delete cascade,
  maker_account_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 1200),
  price_yen integer not null check (price_yen between 1 and 1000000),
  delivery_text text not null check (char_length(delivery_text) between 1 and 20000),
  status text not null default 'published' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
alter table public.ai_staging_boyaki_products enable row level security;
create index if not exists ai_staging_products_status_published_idx
  on public.ai_staging_boyaki_products(status, published_at desc);

create table if not exists public.ai_staging_boyaki_orders (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.ai_staging_boyaki_products(id) on delete restrict,
  buyer_account_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  seller_account_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  amount_yen integer not null check (amount_yen between 1 and 1000000),
  payment_provider text not null default 'ai_staging_test',
  payment_status text not null default 'paid' check (payment_status in ('paid','refunded','cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique(product_id, buyer_account_pubkey)
);
alter table public.ai_staging_boyaki_orders enable row level security;
create index if not exists ai_staging_orders_buyer_created_idx
  on public.ai_staging_boyaki_orders(buyer_account_pubkey, created_at desc);
create index if not exists ai_staging_orders_seller_created_idx
  on public.ai_staging_boyaki_orders(seller_account_pubkey, created_at desc);

create table if not exists public.ai_staging_boyaki_entitlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.ai_staging_boyaki_orders(id) on delete cascade,
  product_id uuid not null references public.ai_staging_boyaki_products(id) on delete cascade,
  buyer_account_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  status text not null default 'active' check (status in ('active','revoked')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(product_id, buyer_account_pubkey)
);
alter table public.ai_staging_boyaki_entitlements enable row level security;
create index if not exists ai_staging_entitlements_buyer_idx
  on public.ai_staging_boyaki_entitlements(buyer_account_pubkey, granted_at desc);

comment on table public.ai_staging_boyaki_products is
  'AI-STAGING-only purchasable products derived from Solution Cases.';
comment on table public.ai_staging_boyaki_orders is
  'AI-STAGING-only test-mode orders. No real payment is processed.';
comment on table public.ai_staging_boyaki_entitlements is
  'AI-STAGING-only delivery rights granted after a paid test order.';