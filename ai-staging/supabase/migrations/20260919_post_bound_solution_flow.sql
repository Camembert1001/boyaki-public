create table if not exists public.ai_staging_boyaki_solution_rooms (
  id text primary key default gen_random_uuid()::text check (id ~ '^[0-9a-f-]{36}$'),
  post_id uuid not null unique references public.ai_staging_boyaki_posts(id) on delete cascade,
  created_by_pubkey text not null check (created_by_pubkey ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_staging_boyaki_solution_rooms enable row level security;

truncate table public.ai_staging_boyaki_solution_room_messages;
alter table public.ai_staging_boyaki_solution_room_messages
  drop constraint if exists ai_staging_boyaki_solution_room_messages_room_id_check;
alter table public.ai_staging_boyaki_solution_room_messages
  add constraint ai_staging_solution_room_messages_room_fkey
  foreign key (room_id) references public.ai_staging_boyaki_solution_rooms(id) on delete cascade;

create table if not exists public.ai_staging_boyaki_solution_cases (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.ai_staging_boyaki_solution_rooms(id) on delete cascade,
  maker_account_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  contribution text not null check (char_length(contribution) between 1 and 800),
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.ai_staging_boyaki_solution_cases enable row level security;
create index if not exists ai_staging_solution_cases_maker_created_idx
  on public.ai_staging_boyaki_solution_cases(maker_account_pubkey, created_at desc);
create index if not exists ai_staging_solution_cases_room_created_idx
  on public.ai_staging_boyaki_solution_cases(room_id, created_at);

comment on table public.ai_staging_boyaki_solution_rooms is
  'AI-STAGING-only post-bound Solution Rooms. One active room per BOYAKI post.';
comment on table public.ai_staging_boyaki_solution_cases is
  'AI-STAGING-only Maker Solution Cases; never mirrored into normal STAGING history.';
