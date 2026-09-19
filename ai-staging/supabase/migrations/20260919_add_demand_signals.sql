create table if not exists public.ai_staging_boyaki_demand_signals (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.ai_staging_boyaki_posts(id) on delete cascade,
  actor_pubkey text not null check (actor_pubkey ~ '^[0-9a-f]{64}$'),
  actor_identity_kind text not null check (actor_identity_kind in ('account','legacy_browser')),
  signal text not null check (signal in ('same_problem','would_try','would_pay')),
  amount_yen integer,
  condition_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(post_id, actor_pubkey, signal),
  check (
    (signal='would_pay' and amount_yen between 1 and 1000000 and char_length(coalesce(condition_text,'')) between 1 and 160)
    or
    (signal<>'would_pay' and amount_yen is null and condition_text is null)
  )
);
alter table public.ai_staging_boyaki_demand_signals enable row level security;
create index if not exists ai_staging_demand_post_signal_idx
  on public.ai_staging_boyaki_demand_signals(post_id, signal, updated_at desc);
comment on table public.ai_staging_boyaki_demand_signals is
  'AI-STAGING-only demand evidence for BOYAKI posts. Signals never write to normal STAGING.';