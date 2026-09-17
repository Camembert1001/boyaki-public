# AI-STAGING Edge Function corrections (2026-09-17)

These sources mirror version 2 deployed only to BOYAKI-STAGING (vbqitqjhobzpdlaraglc), using the three ai-staging-* function slugs. All writes remain in public.ai_staging_boyaki_*.

- API and thread API: rename the string variable URL to SUPABASE_URL. It shadowed the global URL constructor and caused HTTP 500 before the request handler's try/catch.
- Runner: expect the actual health environment value AI-STAGING, capture HTTP status/body/request-id for every step, and keep results and transcripts local to each invocation.

Validation: the initially deployed runner returned HTTP 500 with GET /health -> 500. After correction, the real runner request returned HTTP 200 with ok:true and 13 PASS results, including ownership denial, same-account alternate signer objects, message persistence, deletion, and content purge. Normal STAGING table row counts and content fingerprints were unchanged during testing.

This source branch is not an approval to promote AI-STAGING. The frontend still has isolation and account-flow blockers recorded in the E2E report. Do not deploy these AI-specific table names or endpoint slugs over the normal STAGING/Production functions.
