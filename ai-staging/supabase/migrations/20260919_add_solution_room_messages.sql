create table if not exists public.ai_staging_boyaki_solution_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null check (room_id ~ '^[1-9]$'),
  author_pubkey text not null check (author_pubkey ~ '^[0-9a-f]{64}$'),
  owner_account_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  display_name text,
  content text,
  content_commitment text not null check (content_commitment ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.ai_staging_boyaki_solution_room_messages enable row level security;

create index if not exists ai_staging_solution_room_messages_room_created_idx
  on public.ai_staging_boyaki_solution_room_messages(room_id, created_at);

comment on table public.ai_staging_boyaki_solution_room_messages is
  'AI-STAGING-only Solution Room chat. Never mirrored into STAGING activity/history.';
