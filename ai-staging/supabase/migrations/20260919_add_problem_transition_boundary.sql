alter table public.ai_staging_boyaki_solution_room_invitations
  alter column source_thread_event_id drop not null;

alter table public.ai_staging_boyaki_solution_room_invitations
  add column if not exists invitee_context text not null default 'voice_participant';

alter table public.ai_staging_boyaki_solution_room_invitations
  drop constraint if exists ai_staging_boyaki_solution_room_invitations_invitee_context_check;

alter table public.ai_staging_boyaki_solution_room_invitations
  add constraint ai_staging_boyaki_solution_room_invitations_invitee_context_check
  check (invitee_context in ('source_owner','voice_participant'));

create table if not exists public.ai_staging_boyaki_problem_statements (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.ai_staging_boyaki_posts(id) on delete cascade,
  statement text not null check (char_length(statement) between 10 and 300),
  created_from_invitation_id uuid references public.ai_staging_boyaki_solution_room_invitations(id) on delete set null,
  created_by_account_pubkey text references public.ai_staging_boyaki_accounts(account_pubkey) on delete set null,
  boundary_version text not null default 'solution_room_v1',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_staging_boyaki_problem_statements enable row level security;

create index if not exists ai_staging_problem_statements_status_idx
  on public.ai_staging_boyaki_problem_statements(status, updated_at desc);

comment on table public.ai_staging_boyaki_problem_statements is
  'AI-STAGING shared problem asset created only when the original BOYAKI owner accepts the Solution Room transition.';

comment on column public.ai_staging_boyaki_problem_statements.statement is
  'Generalized problem wording intended to survive withdrawal of the original personal BOYAKI text.';