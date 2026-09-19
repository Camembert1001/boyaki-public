# YN0 Checkpoint

Read this file first when restoring YN0 in a new AI or human session.

This checkpoint is YN0 only. Do not mix BOYAKI state into this directory.

## Objective

Validate real demand and willingness to pay for a small mechanical game-localization preflight tool. It checks mechanical defects, not translation quality.

Current checks/hypothesis include missing or empty targets, placeholder/control-token mismatches, and suspicious whitespace/formatting.

## Source of truth

- State-machine implementation: `internal/contact-state/`
- Live canonical contact data: `internal/contact-state/contacts.local.json`
- The live file is intentionally gitignored and must not be committed to this public repository.
- `fixtures/contacts.json` contains test scenarios only. Never treat fixtures as current contact history.
- For disputed contact state, the original Gmail/GitHub thread is authoritative evidence; update the local canonical record from that evidence.

## Current validated position

Problem validation: evidence exists.

Usefulness validation: evidence exists.

Payer validation: **NOT VALIDATED**.

Do not interpret `payer = UNKNOWN` as “payer answer pending.” Conversation state alone determines whether anything is currently owed.

## Canonical contact status verified from source threads

### Banzai Escape 2 / XenoAisam Studio

- conversation: CLOSED
- next action: DO_NOT_CONTACT
- reopen: INBOUND_ONLY
- problem: POSITIVE
- usefulness: POSITIVE
- workflow: POSITIVE
- payer: AMBIGUOUS
- evidence: real Gmail thread, including supplied TXT files, explicit usefulness confirmation, explicit interest in a TXT-capable version, and an unresolved answer to the $5 question
- important: do not ask more questions unless a new inbound arrives

### Muraoka / Collet Game Translation

- conversation: CLOSED
- next action: DO_NOT_CONTACT
- reopen: INBOUND_ONLY
- problem/usefulness/workflow/payer: UNKNOWN unless new evidence changes them
- evidence: real Gmail thread; after the initial reply we explicitly said there was no need to answer the original questions
- important: no payer answer is outstanding

### Atlos / Open Endfield Map

- conversation: VALIDATING
- next action: WAIT
- problem: POSITIVE
- usefulness: POSITIVE
- payer: UNKNOWN
- current outstanding question: why the existing locale checker/schema has not been wired into CI/release checks
- important: the current wait is a workflow/CI-release question, **not a payer question**
- do not implement a CI/release gate before that answer validates the hypothesis

### Tashiro / Across

- payer-validation outreach sent
- current action: WAIT unless the canonical local store or source thread shows a newer inbound
- payer: UNKNOWN until explicit evidence exists

### Sticky Paws / Jonnil Games

- outreach sent
- current action: WAIT unless the canonical local store or source thread shows a newer inbound

### Aseprite / Igara Studio

- automated acknowledgement is not a human reply
- current action: WAIT unless a human inbound has arrived

### OyasumiVR

- problem: POSITIVE
- usefulness: POSITIVE
- observe only
- does not count toward payer validation because it is a free product

## Technical state

- mechanical distribution scanner exists
- adapter boundary exists / is being proposed separately
- JSON is the only intended adapter until a real respondent validates another format
- do not add speculative CSV/PO/YAML adapters
- do not build GUI, SaaS, billing, automatic outreach, automatic follow-up, or a CI/release gate without validation

## Decision gates

1. Explicit payer YES from a countable contact:
   add only the file-format support actually required by that validated payer and re-test.

2. Atlos confirms a real CI/release integration problem:
   open the Localization Regression Gate hypothesis as a separate validation track.

3. No payer evidence:
   do not expand the product speculatively.

## Restore procedure

1. Read this file.
2. Read `internal/contact-state/README.md`.
3. If available locally, run:
   `node internal/contact-state/state.mjs internal/contact-state/contacts.local.json --strict`
4. If the local canonical store is unavailable or stale, verify current source threads before changing a contact state.
5. Run:
   `node --test internal/contact-state/tests/contact-state.test.mjs`
6. Only then decide the next YN0 action.

## Separation rule

PR #12 / `internal/contact-state/` is the canonical state-machine direction.

Do not create a second YN0 state machine under `internal/yn0/`. A second implementation would create competing sources of truth.

PR #13 was an alternate implementation and must not be merged alongside this one.
