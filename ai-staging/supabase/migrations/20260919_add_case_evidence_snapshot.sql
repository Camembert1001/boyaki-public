alter table public.ai_staging_boyaki_solution_cases
  add column if not exists evidence_snapshot jsonb not null default '{}'::jsonb;

comment on column public.ai_staging_boyaki_solution_cases.evidence_snapshot is
  'Demand evidence snapshot captured when the AI-STAGING Solution Case is created.';