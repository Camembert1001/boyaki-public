# YN0 Validation State (internal)

The single source of truth for YN0's validation contacts: who was asked what, what
they answered, what evidence backs that answer, and what — if anything — we should do
next.

**YN0 only.** BOYAKI keeps its own state elsewhere and none of it belongs in this
directory. Every record carries `program: "YN0"` and the loader rejects anything that
does not.

**This is not a CRM and not sales automation.** It sends nothing, opens nothing,
schedules nothing and holds no credentials. It is a state file, a derivation, and a
reader. Every outbound message remains a human decision; `next_action` is a
recommendation to a human, never a trigger.

Start from [`CHECKPOINT.md`](CHECKPOINT.md) — it is what another session reads first.

## Layout

| Path | What it is |
| --- | --- |
| `CHECKPOINT.md` | YN0's recovery point: objective, hypotheses, contacts, gates |
| `contacts.json` | The SSOT: one record per contact |
| `state.mjs` | Read-only CLI over the store |
| `lib/model.mjs` | Enums, record shape, invariants, legal transitions |
| `lib/transitions.mjs` | The state machine: the only way state changes |
| `lib/derive.mjs` | Derived fields and the `next_action` rules |
| `lib/store.mjs` | Load, validate, render |
| `tests/state.test.mjs` | The cases below, pinned |

## Usage

```
node internal/yn0/state.mjs                 # current state, one block per contact
node internal/yn0/state.mjs --format json   # the same data, machine-readable
node internal/yn0/state.mjs --check         # validate the store, print nothing
node --test internal/yn0/tests/state.test.mjs
```

No dependencies, no install step, no network. Node 22 built-ins only. Output carries
no timestamp, so two runs over the same store are byte-identical.

## The distinction this exists to enforce

> **"We sent a question" is not "we should currently be waiting for its answer."**

Conflating the two is what caused the original error: a contact whose conversation had
actually been closed was read as *awaiting a payer-validation reply*, because its
`payer` answer was unknown.

So the two are stored separately and neither is derived from the other:

- **Validation state** answers *what do we know?* `UNKNOWN` means **no evidence**.
  It never means "a reply is pending".
- **Conversation state** answers *what is owed, and by whom?* Whether an answer is
  owed to us is `conversation.waiting_for_reply`, and it is stored.

Muraoka is the worked example. Every validation dimension is `UNKNOWN`, exactly like
Tashiro's — and Tashiro is `WAIT` while Muraoka is `DO_NOT_CONTACT`, because the
questions were explicitly released. A test asserts that difference survives.

## Stored record

```json
{
  "id": "atlos-open-endfield-map",
  "program": "YN0",
  "name": "Atlos maintainers",
  "organization": "Atlos (Open Endfield Map)",
  "channel": "EMAIL",
  "counts_toward_payer_validation": true,
  "conversation": {
    "outreach_status": "FOLLOW_UP_SENT",
    "human_reply": true,
    "conversation_status": "AWAITING_REPLY",
    "waiting_for_reply": true,
    "follow_up_allowed": false,
    "reopen_condition": "OPEN",
    "last_inbound_at": null,
    "last_outbound_at": null,
    "last_auto_ack_at": null
  },
  "validation": {
    "problem":    {"status": "POSITIVE",  "evidence": [ … ]},
    "usefulness": {"status": "POSITIVE",  "evidence": [ … ]},
    "workflow":   {"status": "AMBIGUOUS", "evidence": [ … ]},
    "payer":      {"status": "UNKNOWN",   "evidence": []}
  },
  "notes": [ … ]
}
```

### Enums

| Field | Values |
| --- | --- |
| validation status | `UNKNOWN` `POSITIVE` `NEGATIVE` `AMBIGUOUS` |
| `conversation_status` | `DISCOVERED` `CONTACTED` `AWAITING_REPLY` `REPLIED` `VALIDATING` `STALLED` `CLOSED` `OBSERVE` |
| `outreach_status` | `NOT_SENT` `SENT` `AUTO_ACK_ONLY` `FOLLOW_UP_SENT` `ANSWERED` |
| `reopen_condition` | `INBOUND_ONLY` `NEVER` `OPEN` |
| `next_action` | `WAIT` `FOLLOW_UP` `RESPOND` `DO_NOT_CONTACT` `CLOSE` `OBSERVE` `REVIEW` |
| `channel` | `EMAIL` `GITHUB_ISSUE` `CONTACT_FORM` `UNRECORDED` |

`AMBIGUOUS` is not `UNKNOWN`. It means *we have their answer and the answer does not
resolve to yes or no* — Banzai Escape 2's reply to the $5 question is the case.

## Evidence

Any status other than `UNKNOWN` is a claim about what a person said, so it must carry
its source. The loader rejects a record that claims one without evidence:

```json
{
  "source": "gmail",
  "ref": null,
  "summary": "Asked directly whether they would pay $5 one-time; the answer declined to resolve either way.",
  "quote": "That. I don't know. I cannot answer YEs or No.",
  "observed_at": null
}
```

`source` is one of `gmail` `github` `web_form` `manual`. `ref` is the message id,
issue URL or thread handle; explicit `null` means no stable identifier was captured
and is a recorded gap, not an excuse to omit the field. `summary` is required.

Guessing is therefore not expressible: an unevidenced hunch stays `UNKNOWN`.

## Invariants

The loader refuses a store that breaks any of these:

- `AWAITING_REPLY` requires `waiting_for_reply: true`, and `waiting_for_reply: true`
  is legal only in `AWAITING_REPLY` or `VALIDATING`.
- `CLOSED`, `STALLED` and `OBSERVE` require `waiting_for_reply: false` **and**
  `follow_up_allowed: false`. This is what prevents re-selling a closed contact.
- `CLOSED` and `STALLED` cannot carry `reopen_condition: OPEN`.
- `outreach_status: ANSWERED` requires `human_reply: true`;
  `outreach_status: AUTO_ACK_ONLY` requires `human_reply: false`.
- A validation status other than `UNKNOWN` requires at least one evidence entry.
- Every contact is `program: "YN0"`, and contact ids are unique.

## Transitions

State changes only through `lib/transitions.mjs`, which returns a new record and
re-validates it, so an illegal move throws rather than being written:

| Transition | Effect |
| --- | --- |
| `recordOutreach` | → `AWAITING_REPLY`, waiting |
| `recordOutboundQuestion` | → `AWAITING_REPLY`, waiting |
| `recordAutoAck` | records `last_auto_ack_at` only; **never** sets `human_reply` |
| `recordHumanInbound` | → `REPLIED`, not waiting; the re-open path |
| `recordValidation` | sets one dimension + evidence; touches no conversation state |
| `releaseWaiting` | → `CONTACTED`, not waiting; the question stays sent |
| `allowFollowUp` | grants one follow-up; refuses while an answer is owed to us |
| `stallConversation` | → `STALLED`, `INBOUND_ONLY` |
| `closeConversation` | → `CLOSED`, `INBOUND_ONLY` |
| `observeOnly` | → `OBSERVE` |

Legal `conversation_status` moves live in `ALLOWED_TRANSITIONS`. The ones that matter:

- `CLOSED → REPLIED` and `STALLED → REPLIED` exist **only** through
  `recordHumanInbound`, and only when `reopen_condition` is `INBOUND_ONLY`. They may
  re-open the conversation; we may not.
- There is no path from `CLOSED` to `AWAITING_REPLY`. We cannot put ourselves back in
  a closed contact's queue.
- `AWAITING_REPLY → CONTACTED` is `releaseWaiting`: stop expecting an answer without
  closing the conversation.

## Derived state

Pure functions of the stored record — no clock, no network, no model call.

| Derived | Rule |
| --- | --- |
| `is_waiting` | `waiting_for_reply` |
| `can_follow_up` | `follow_up_allowed` and the conversation is not `CLOSED`/`STALLED`/`OBSERVE` |
| `is_validated` | `problem` and `usefulness` both `POSITIVE` (payer is deliberately excluded) |
| `is_payer_validated` | `payer` is `POSITIVE` **and** `counts_toward_payer_validation` |
| `can_reopen` | finished, with `reopen_condition: INBOUND_ONLY` |
| `needs_attention` | `next_action` is `RESPOND`, `FOLLOW_UP`, `REVIEW` or `CLOSE` |

`counts_toward_payer_validation: false` is how a free product stays out of the payer
count: OyasumiVR's maintainer cannot answer a purchase question, so no answer from
that contact can move the number.

### next_action

First matching rule wins. The result is always one of the seven values, and the
derivation reports which rule fired, so the choice can be audited rather than trusted.
Free text from a chat log never decides it: at most it becomes evidence that changes a
stored field, and the stored field changes the derivation.

| # | Rule | When | Action |
| --- | --- | --- | --- |
| 1 | `observe` | `conversation_status` is `OBSERVE` | `OBSERVE` |
| 2 | `finished-no-follow-up` | `CLOSED` or `STALLED`, follow-up not allowed | `DO_NOT_CONTACT` |
| 3 | `ball-in-our-court` | their message is the last one | `RESPOND` |
| 4 | `waiting` | `waiting_for_reply` | `WAIT` |
| 5 | `not-contacted` | `DISCOVERED` | `REVIEW` |
| 6 | `follow-up-allowed` | live conversation, follow-up explicitly allowed | `FOLLOW_UP` |
| 7 | `spent` | live, nothing owed either way, no follow-up allowed | `CLOSE` |
| — | fallback | nothing matched | `REVIEW` |

Rule 2 sits above rule 3 on purpose: a finished conversation stays finished even if
the timestamps look like a reply is owed. Re-opening is `recordHumanInbound`, an
explicit transition, not a side effect of the ordering.

"Their message is the last one" is `last_inbound_at > last_outbound_at` when both are
recorded. For the current contacts neither is — no message ids or dates were captured
while those exchanges happened — so it falls back to `REPLIED` and not waiting, which
states the same fact. Note that an auto-acknowledgement writes `last_auto_ack_at`, not
`last_inbound_at`, so a ticket receipt can never make us look like we owe a reply.

## Tests

```
node --test internal/yn0/tests/state.test.mjs
```

The ten required cases are pinned, plus the model and store guards:

1. outreach sent, no human reply → `AWAITING_REPLY`, `WAIT`
2. usefulness yes, payer unasked → `usefulness POSITIVE`, `payer UNKNOWN`
3. explicit $5 yes → `payer POSITIVE`, evidence attached
4. a clear "we do not need this" → `NEGATIVE`
5. Muraoka → `payer UNKNOWN`, `waiting_for_reply false`, `DO_NOT_CONTACT`
6. Banzai → `CLOSED`, `payer AMBIGUOUS`, `DO_NOT_CONTACT`
7. Atlos → `usefulness POSITIVE`, `payer UNKNOWN`, `AWAITING_REPLY`
8. auto-ack only → `human_reply false`
9. new human inbound on a `CLOSED` contact → re-opens; we still cannot
10. OyasumiVR → never counted as payer validation, even given a hypothetical yes

## Known limitations

- Timestamps and evidence `ref`s are `null` for the contacts seeded from the existing
  record; nothing captured them at the time. New entries should carry them.
- `channel` was taken from the shape of the outreach programme, not a per-thread
  record, so every contact but OyasumiVR reads `EMAIL`.
- The store is edited by hand. `transitions.mjs` is the state machine and the tests
  exercise it, but there is no write-back CLI — a hand edit that breaks an invariant
  is caught by `state.mjs --check`, not prevented.
- `next_action` is advice. Nothing in this repository acts on it.
