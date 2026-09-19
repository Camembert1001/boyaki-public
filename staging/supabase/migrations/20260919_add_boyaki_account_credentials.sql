create table if not exists public.boyaki_account_credentials (
  account_pubkey text primary key references public.boyaki_accounts(account_pubkey) on delete cascade,
  login_key_hash text not null unique check (login_key_hash ~ '^[0-9a-f]{64}$'),
  encrypted_secret text not null check (char_length(encrypted_secret) between 80 and 2048),
  credential_version integer not null default 1 check (credential_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.boyaki_account_credentials enable row level security;
comment on table public.boyaki_account_credentials is
  'STAGING-only BOYAKI app credential envelope. The stable login-key hash identifies an account; encrypted_secret is a NIP-49 ciphertext replaced on BOYAKI password reset. No plaintext password or secret key is stored.';
