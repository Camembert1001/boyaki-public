# YN0 Checkpoint

Read this file first when restoring YN0 in a new AI or human session.

This checkpoint is YN0 only. Do not mix BOYAKI state into this directory.

**This file is tracked, so it holds no contact data.** It records the objective, the
hypothesis, the rules and how to restore — never who was contacted or what state any
individual conversation is in. Anything that could identify a real contact, or that
states one contact's current position, belongs in `CHECKPOINT.local.md`, which is
gitignored and must never be committed to this public repository.

## Objective

Validate real demand and willingness to pay for a small mechanical game-localization
preflight tool. It checks mechanical defects, not translation quality.

## Product hypothesis

Projects that ship localized builds hit *mechanical* locale defects — missing or empty
targets, placeholder and control-token mismatches, suspicious whitespace and formatting —
and would rather catch them before release than after. The tool under validation is a
small preflight that reports exactly those defects and nothing else.

The hypothesis is not validated until someone pays for it.

## Payer validation is the gate

Problem and usefulness can both be POSITIVE while the product is still worth nothing.
**Payer validation is the only signal that decides whether YN0 expands**, and it requires
an explicit statement from a countable contact, cited as evidence.

Do not interpret `payer = UNKNOWN` as "payer answer pending." `UNKNOWN` is a statement
about what we know. Conversation state alone determines whether anything is currently
owed, and the model enforces that separation:

- `payer = UNKNOWN` never by itself produces `is_waiting`; only an open question on the
  wire does.
- Every outbound event against a CLOSED contact is refused by name. A follow-up the state
  does not permit cannot be recorded at all.
- A CLOSED contact with `reopen_condition: INBOUND_ONLY` reopens on a human inbound and on
  nothing else — an automated acknowledgement leaves it closed.
- An outstanding answer names the axis it would settle, so a workflow question is never
  reported as a price question.

## Source of truth

| What | Where | Tracked |
| --- | --- | --- |
| Live canonical contact data | `internal/contact-state/contacts.local.json` | **no** — gitignored |
| Human-readable position on individual contacts | `internal/contact-state/CHECKPOINT.local.md` | **no** — gitignored |
| State-machine implementation | `internal/contact-state/` | yes |
| Test scenarios | `internal/contact-state/fixtures/contacts.json` | yes |

**Real contact data is never tracked.** `*.local.json` and `*.local.md` in this directory
are gitignored, and nothing that identifies a real contact may be committed to this public
repository — not in this file, not in the README, not in fixtures, not in a test.

For disputed contact state, the original Gmail/GitHub thread is authoritative evidence;
update the local canonical record from that evidence.

### Fixtures are not data

`fixtures/contacts.json` contains test scenarios only. Never treat a fixture as current
contact history.

Fixture ids name conversation *shapes* (`waived-then-closed`,
`validating-workflow-answer`) and fixture names are `Prospect <letter>`. No fixture
carries a real contact's name, and a test enforces that. If a fixture ever appears to
describe a real contact, the fixture is wrong, not the contact.

If the local store is missing, rebuild it from the source threads. Never fall back to
fixtures.

## Recording a contact in the local store

Every state YN0 has actually produced is expressible as an event log in
`contacts.local.json`, and each shape is covered by a fixture, so the model is verified to
produce it:

| Shape | Event log | Fixture |
| --- | --- | --- |
| CLOSED, several axes POSITIVE, payer AMBIGUOUS, DO_NOT_CONTACT | `OUTREACH_SENT` → `INBOUND_REPLY` → `VALIDATION_RECORDED` per axis → `CONVERSATION_ENDED` | `useful-payer-ambiguous` |
| CLOSED after we released them from answering, all axes UNKNOWN, nothing outstanding, DO_NOT_CONTACT | `OUTREACH_SENT` → `INBOUND_REPLY` → `QUESTION_SENT` → `REPLY_WAIVED` → `CONVERSATION_ENDED` | `waived-then-closed` |
| VALIDATING, waiting on a workflow question, payer UNKNOWN, WAIT | `OUTREACH_SENT` → `INBOUND_REPLY` → `VALIDATION_RECORDED` → `QUESTION_SENT` with `waiting_for_axis: workflow` | `validating-workflow-answer` |
| An autoresponder came back and nothing else | `INBOUND_REPLY` with `human: false` | `auto-ack-only`, `closed-then-auto-ack` |

See [`README.md`](README.md) for the full event and field reference.

## Technical state

- a mechanical distribution scanner exists
- an adapter boundary exists / is being proposed separately
- JSON is the only intended adapter until a real respondent validates another format
- a prospect discovery layer sits on top of the scanner, and reads this directory rather
  than duplicating it: contact posture comes from `derive()`, and the validation
  hypothesis it filters candidates against is derived from the axes recorded here. There
  is no second validation model, and discovery writes nothing back.
- discovery ends at human review. It has no outreach surface, and it never records that a
  contact was checked — only a human reading the local store may claim that.

## Decision gates

1. **Explicit payer YES from a countable contact:** add only the file-format support that
   validated payer actually requires, and re-test.

2. **A contact confirms a real CI/release integration problem** (the workflow hypothesis):
   open the Localization Regression Gate as a separate validation track. Do not implement
   a CI/release gate before an answer validates that hypothesis.

3. **No payer evidence:** do not expand the product speculatively.

## Do not

- do not commit real contact data to this repository, in any file or any format
- do not add speculative CSV/PO/YAML adapters
- do not build a Gmail integration
- do not build automatic outreach or automatic follow-up
- do not build a GUI, dashboard, SaaS, or billing
- do not implement a CI/release gate
- do not add a feature no respondent has validated
- do not change BOYAKI from this track
- do not create a second YN0 state machine under `internal/yn0/`; a second implementation
  would create competing sources of truth
- PR #13 was an alternate implementation and must not be merged alongside this one

## Restore procedure

1. Read this file.
2. Read `internal/contact-state/README.md`.
3. Read `internal/contact-state/CHECKPOINT.local.md` if it exists locally — that is where
   the position on individual contacts lives.
4. If available locally, run:
   `node internal/contact-state/state.mjs internal/contact-state/contacts.local.json --strict`
5. If the local canonical store is unavailable or stale, verify the current source threads
   before changing any contact state. Do not reconstruct contact state from this
   repository; it does not contain any.
6. Run:
   `node --test internal/contact-state/tests/contact-state.test.mjs`
7. Only then decide the next YN0 action.
