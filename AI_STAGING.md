# BOYAKI AI-STAGING

## Purpose

`ai-staging` is the AI implementation and destructive-testing lane for BOYAKI.

Environment promotion is one-way:

`ai-staging` -> `staging` -> `production`

## Rules

- AI implementation work starts on the `ai-staging` branch.
- AI agents may modify, break, reset, instrument, or experiment inside AI-STAGING.
- AI agents must not directly promote changes from AI-STAGING to production.
- The existing `/staging/` surface remains the human/device E2E and release-candidate gate.
- Promotion to STAGING requires an explicit reviewed change set and E2E evidence.
- Promotion to PRODUCTION requires successful STAGING verification.
- Production credentials/data must never be used for destructive AI-STAGING testing.

## Current bootstrap state

This branch was cloned from the current `main` baseline so AI work begins from the same code snapshot as the current BOYAKI public/staging repository.

A fully isolated AI-STAGING backend (separate Supabase project/credentials) is still required before destructive database or schema experiments are allowed.

Until that backend exists, treat AI-STAGING as **code-isolated but not yet data-isolated**.
