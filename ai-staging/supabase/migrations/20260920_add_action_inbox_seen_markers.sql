create table if not exists public.ai_staging_boyaki_inbox_seen (
  account_pubkey text not null references public.ai_staging_boyaki_accounts(account_pubkey) on delete cascade,
  item_key text not null check (char_length(item_key) between 3 and 220),
  seen_at timestamptz not null default now(),
  primary key (account_pubkey, item_key)
);
alter table public.ai_staging_boyaki_inbox_seen enable row level security;
create index if not exists ai_staging_inbox_seen_account_idx
  on public.ai_staging_boyaki_inbox_seen(account_pubkey, seen_at desc);
comment on table public.ai_staging_boyaki_inbox_seen is
  'AI-STAGING-only lightweight read markers for derived Action Inbox items. No notification payloads are persisted.';