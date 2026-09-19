create table if not exists public.ai_staging_boyaki_solution_room_invitations (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.ai_staging_boyaki_solution_rooms(id) on delete cascade,
  post_id uuid not null references public.ai_staging_boyaki_posts(id) on delete cascade,
  inviter_maker_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  invitee_account_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  source_thread_event_id uuid not null references public.ai_staging_boyaki_thread_events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique(room_id, invitee_account_pubkey),
  check (inviter_maker_pubkey <> invitee_account_pubkey)
);
alter table public.ai_staging_boyaki_solution_room_invitations enable row level security;
create index if not exists ai_staging_room_invite_invitee_idx
  on public.ai_staging_boyaki_solution_room_invitations(invitee_account_pubkey, status, updated_at desc);

create table if not exists public.ai_staging_boyaki_product_thread_publications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.ai_staging_boyaki_products(id) on delete cascade,
  post_id uuid not null references public.ai_staging_boyaki_posts(id) on delete cascade,
  room_id text not null references public.ai_staging_boyaki_solution_rooms(id) on delete cascade,
  published_by_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  status text not null default 'active' check (status in ('active','withdrawn')),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_staging_boyaki_product_thread_publications enable row level security;
create index if not exists ai_staging_product_thread_post_idx
  on public.ai_staging_boyaki_product_thread_publications(post_id, status, published_at desc);

comment on table public.ai_staging_boyaki_solution_room_invitations is
  'AI-STAGING-only Maker invitations from BOYAKI thread Voice participants into the source Solution Room.';
comment on table public.ai_staging_boyaki_product_thread_publications is
  'AI-STAGING-only publish-back references from a Product to its exact source BOYAKI thread.';