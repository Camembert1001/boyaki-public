# AI-STAGING isolation

Deploy these three functions only to BOYAKI-STAGING (`vbqitqjhobzpdlaraglc`) with their `ai-staging-*` names. All application tables use `ai_staging_boyaki_*`. Custom signed HTTP authentication is enforced by the APIs; `verify_jwt` remains false. Never deploy these sources over another environment’s function names.

The 2026-09-17 URL-shadowing and runner fixes are included. The 2026-09-18 correction routes account profiles and identity links through the dedicated API, preserves profiles on post/thread writes, and purges a deleted post’s thread. The runner uses POST (OPTIONS is side-effect free), records response bodies/status/request IDs, and attempts API cleanup if an assertion fails.

Frontend storage uses `ai-staging:boyaki:`. No old key migration is performed. The worker only reads, writes and expires its own cache prefix and AI path. Public relays and legacy write forms remain closed. Existing local Solution Case history is clearly labelled as browser-local.

Run `node ai-staging/tests/isolation.test.mjs` from the repository root. Run `POST /functions/v1/ai-staging-e2e-runner` for live HTTP tests; its response includes every step and response. Frontend selftest calls that same dedicated runner. This is not permission to promote changes to STAGING or Production.
