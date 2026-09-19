# YN0 Contact State (internal)

A minimal state machine for the YN0 validation pipeline. It answers three questions
about one contact, mechanically:

1. **What state is this conversation in?**
2. **What have we actually validated, and on what evidence?**
3. **Are we allowed to send anything next?**

It exists because those three were being read off each other. A contact whose payer
question had gone unanswered — after we told them they need not answer — was reported as
"awaiting a payer answer", because `payer: UNKNOWN` was treated as "the answer is still
coming". It is not: `UNKNOWN` is a statement about what we know, and only the
conversation block decides whether a reply is outstanding.

**This is not a CRM and not an outreach tool.** It sends no mail, opens no issue, posts
no comment, drives no browser, holds no credentials, makes no network call, and reads no
clock. It folds an event log into a record and prints the state. Every message on the
wire is still sent by a human; this only says what state the contact is in and which of
six actions is permitted.

## Usage

```
node internal/contact-state/state.mjs internal/contact-state/fixtures/contacts.json
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--format <text\|json>` | `text` | Output format on stdout |
| `--out <file>` | — | Also write the JSON report to a file |
| `--id <id>` | — | Report one contact |
| `--action <ACTION>` | — | Report only contacts with this `next_action` |
| `--attention` | — | Report only contacts with `needs_attention` |
| `--strict` | — | Exit 1 if any reported contact contradicts itself |
| `-h`, `--help` | — | Show usage |

Exit codes: `0` success, `1` unreadable or invalid store (or `--strict` with a
contradiction), `2` bad arguments.

Sample output:

```
[CLOSE] muraoka (Muraoka)
  conversation: STALLED - outreach SENT - human_reply true - in 2026-09-09T00:41:00Z - out 2026-09-11T08:00:00Z
  flags: waiting_for_reply=false - waiting_for=NOTHING - follow_up_allowed=false - reopen=INBOUND_ONLY
  validation: problem UNKNOWN(0) - usefulness UNKNOWN(0) - workflow UNKNOWN(0) - payer UNKNOWN(0)
  derived: waiting false - can_follow_up false - validated false - payer_validated false - needs_attention false
  reason: we told them no reply is needed, so no answer is outstanding
```

The report carries no timestamp and no randomness, so two runs over the same store are
byte-identical.

## Where the real store lives

`fixtures/contacts.json` is fixtures, not data. **Real contact records do not belong in
this public repository.** Keep the live store in an untracked file — `*.local.json` in
this directory is gitignored — and point the CLI at it:

```
node internal/contact-state/state.mjs internal/contact-state/contacts.local.json
```

Even there, keep identities to what the channel already shows (a handle, a project name)
and evidence to a short quote or summary. The model never needs an email address: the
channel and a message id are enough to find the thread again.

## Store format

One JSON file. Each contact is **either** an event log **or** a resolved state record —
carrying both is rejected, because that is two sources of truth for one contact.

```json
{
  "schema": "yn0-contact-state-v1",
  "contacts": [
    {
      "id": "muraoka",
      "name": "Muraoka",
      "channel": "GMAIL",
      "events": [
        {"type": "OUTREACH_SENT", "at": "2026-09-08T09:00:00Z", "waiting_for": "FIRST_REPLY"},
        {"type": "INBOUND_REPLY", "at": "2026-09-09T00:41:00Z"},
        {"type": "QUESTION_SENT", "at": "2026-09-09T09:05:00Z", "waiting_for": "PAYER_ANSWER"},
        {"type": "REPLY_WAIVED", "at": "2026-09-11T08:00:00Z"},
        {"type": "NO_REPLY_TIMEOUT", "at": "2026-09-18T09:00:00Z"}
      ]
    }
  ]
}
```

Events must be in non-decreasing chronological order, and every `at` is an ISO 8601 UTC
instant. Nothing is inferred from the current time — `NO_REPLY_TIMEOUT` is an event a
human records, not a clock deciding that silence has gone on long enough.

## State model

### identity

| Field | Values |
| --- | --- |
| `id` | required, unique in the store |
| `name`, `organization` | free text or `null` |
| `channel` | `GMAIL`, `GITHUB_ISSUE`, `GITHUB_COMMENT`, `OTHER` |
| `channel_ref` | thread/issue reference, or `null` |

### conversation — what happened on the wire

| Field | Values |
| --- | --- |
| `outreach_status` | `NOT_SENT`, `SENT`, `FAILED` |
| `human_reply` | a human (not a bot, not a bounce) has written to us |
| `conversation_status` | `DISCOVERED`, `CONTACTED`, `AWAITING_REPLY`, `REPLIED`, `VALIDATING`, `STALLED`, `CLOSED` |
| `waiting_for` | `NOTHING`, `FIRST_REPLY`, `VALIDATION_ANSWER`, `PAYER_ANSWER` |
| `waiting_for_reply` | an answer is genuinely outstanding |
| `reply_waived` | we told them an answer is not needed |
| `follow_up_allowed` | we may send again |
| `reopen_condition` | `NOT_APPLICABLE`, `INBOUND_ONLY`, `NEVER` |
| `closed_reason` | why the thread ended, or `null` |
| `inbound_since_close` | an opted-out contact wrote to us; a human must look |
| `last_inbound_at`, `last_outbound_at` | ISO instants or `null` |

`CONTACTED` is outreach that asked nothing; `AWAITING_REPLY` is outreach that asked and
has not been answered. "We sent the question" is `last_outbound_at` plus `waiting_for`;
"an answer is owed" is `waiting_for_reply`. They are set by different events and cleared
by different events.

### validation — what we learned

Four independent axes: `problem`, `usefulness`, `workflow`, `payer`. Each is

```json
{"status": "POSITIVE", "evidence": [
  {"source": "gmail", "message_id": "...", "quote_or_summary": "...", "observed_at": "..."}
]}
```

with `status` one of `UNKNOWN`, `POSITIVE`, `NEGATIVE`, `AMBIGUOUS`.

**Anything other than `UNKNOWN` requires at least one evidence entry**, and recording one
is refused without it. `quote_or_summary` is what the person said, quoted or summarised —
not our reading of what they meant. A thank-you is `AMBIGUOUS` on usefulness, never
`POSITIVE`: it is evidence of politeness, not of use. Silence is never evidence of
anything and stays `UNKNOWN`.

## Transition rules

`VALIDATION_RECORDED` writes only to `validation`. Every other event writes only to
`conversation`. Nothing writes to both.

| Event | Precondition | Effect |
| --- | --- | --- |
| `OUTREACH_SENT` | not `CLOSED`/opted out, nothing sent yet | `SENT`; `AWAITING_REPLY` (or `CONTACTED` with `expects_reply: false`); `follow_up_allowed = true` |
| `QUESTION_SENT` | outreach sent, not `CLOSED`, not waived | `VALIDATING`; `waiting_for = VALIDATION_ANSWER \| PAYER_ANSWER`; `waiting_for_reply = true` |
| `FOLLOW_UP_SENT` | `follow_up_allowed`, not `CLOSED`, not waived | re-enters `AWAITING_REPLY`/`VALIDATING`; `waiting_for_reply = true` |
| `REPLY_WAIVED` | not `CLOSED`/opted out | `reply_waived = true`; `waiting_for_reply = false`; `waiting_for = NOTHING`; `follow_up_allowed = false` |
| `INBOUND_REPLY` | any state except opted out | `REPLIED`; `human_reply = true`; clears waiting, waiver and `closed_reason`; `follow_up_allowed = true`; reopens a contact closed under `INBOUND_ONLY` |
| `NO_REPLY_TIMEOUT` | contacted, not `CLOSED` | `STALLED`; `waiting_for_reply = false`; `follow_up_allowed = !reply_waived`; `reopen_condition = INBOUND_ONLY` |
| `CONVERSATION_ENDED` | any live state | `CLOSED`; `follow_up_allowed = false`; `reopen_condition = INBOUND_ONLY` |
| `OPT_OUT` | any live state | `CLOSED`; `reopen_condition = NEVER` |
| `VALIDATION_RECORDED` | evidence present unless `UNKNOWN` | sets one axis; **touches no conversation field** |

Outbound events (the first four) are **refused** — they throw, naming the blocking field —
when the contact is `CLOSED`, opted out, or has been released from replying. That refusal
is the mechanical part of "no follow-up to a finished conversation": there is no way to
record a follow-up that the state does not permit.

An `INBOUND_REPLY` from an opted-out contact does not reopen anything. It records the
message, sets `inbound_since_close`, and routes to `REVIEW` for a human.

## Derived state

Pure functions of the record, recomputed on every read, never stored:

| Field | Rule |
| --- | --- |
| `owes_response` | thread is live and `last_inbound_at > last_outbound_at` |
| `is_waiting` | `waiting_for_reply` ∧ ¬`reply_waived` ∧ status ∈ {`AWAITING_REPLY`, `VALIDATING`} ∧ `waiting_for ≠ NOTHING` ∧ ¬`owes_response` |
| `can_follow_up` | `follow_up_allowed` ∧ ¬`reply_waived` ∧ live status ∧ outreach sent ∧ not opted out ∧ no `NEGATIVE` on problem/usefulness ∧ no inconsistency |
| `is_validated` | `problem = POSITIVE` ∧ `usefulness = POSITIVE` |
| `is_payer_validated` | `payer = POSITIVE` (which, by the evidence rule, means an explicit statement) |
| `needs_attention` | an inconsistency, an unanswered inbound, an opted-out contact writing back, or `next_action = REVIEW` |
| `inconsistencies` | stored fields that contradict each other (see below) |

### next_action

Six values, decided by the first matching rule. No free text decides anything; the rule
that fired is reported as `next_action_reason`.

| # | Condition | Action |
| --- | --- | --- |
| 1 | the record contradicts itself | `REVIEW` |
| 2 | an opted-out contact wrote to us | `REVIEW` |
| 3 | `reopen_condition = NEVER` | `DO_NOT_CONTACT` |
| 4 | `owes_response` | `RESPOND` |
| 5 | `conversation_status = CLOSED` | `DO_NOT_CONTACT` |
| 6 | `is_waiting` | `WAIT` |
| 7 | `problem` or `usefulness` is `NEGATIVE` | `CLOSE` |
| 8 | `reply_waived` | `CLOSE` |
| 9 | `STALLED` ∧ ¬`can_follow_up` | `CLOSE` |
| 10 | `conversation_status = DISCOVERED` | `REVIEW` |
| 11 | `can_follow_up` | `FOLLOW_UP` |
| 12 | anything else | `REVIEW` |

`CLOSE` means "close this record", not "send a closing message". `FOLLOW_UP` means a
follow-up is *permitted*, not that one should be written — a human still decides whether
and what to send.

### Inconsistencies

Contradictions between stored fields are reported, not repaired, and force `REVIEW` — the
one outcome that sends nothing. Checked: waiting while `CLOSED`/`STALLED`/`DISCOVERED`;
waiting for `NOTHING`; waiting after a waiver; waiting with no outreach sent;
`follow_up_allowed` on a closed or opted-out contact; a closed or stalled contact with no
`reopen_condition`; timestamps that disagree with `outreach_status` / `human_reply`; and
any validation axis that left `UNKNOWN` without evidence or without a human reply.

## Fixtures

`fixtures/contacts.json` holds one contact per scenario the pipeline actually produced:

| Contact | Shape | Result |
| --- | --- | --- |
| `no-reply-yet` | outreach sent, no human reply | `AWAITING_REPLY`, `WAIT` |
| `useful-payer-unknown` | usefulness yes, payer question open | `usefulness POSITIVE`, `payer UNKNOWN`, `VALIDATING`, `WAIT` |
| `payer-positive` | "would buy at $5" | `payer POSITIVE`, `RESPOND` |
| `clearly-not-needed` | explicit "not needed" | `problem`/`usefulness NEGATIVE`, `CLOSE` |
| `muraoka` | payer question sent, human replied, never answered, reply waived, silence | `payer UNKNOWN`, `STALLED`, `waiting_for_reply = false`, `CLOSE` |
| `banzai` | thanked us and ended the thread | `usefulness AMBIGUOUS`, `CLOSED`, `DO_NOT_CONTACT` |
| `atlos` | closed for silence, then wrote to us | reopened to `REPLIED`, `RESPOND` |

`muraoka` and `banzai` reproduce the two conversation shapes that motivated this work.
`atlos` is modelled as the reopen case: the repository holds no record of its actual
thread, so its timeline is the shape, not the history. Replace all three with the real
event logs in the untracked local store before treating them as data.

## Tests

```
node --test internal/contact-state/tests/contact-state.test.mjs
```

No dependencies, no install step, no network. Node 22 built-ins only. The suite covers
the seven fixtures, the transition path, the separation of the two blocks, the evidence
requirement, refusal of outbound events, reopening, the consistency checker, store
validation, determinism and the CLI.

## Known limitations

- **The store is hand-maintained.** Nothing imports from Gmail or the GitHub API; an
  operator records events after reading the thread. That is deliberate — the alternative
  was a Gmail integration, which this work explicitly excluded — but it means the store is
  only as current as the last time someone updated it.
- **`NO_REPLY_TIMEOUT` is a judgement, not a duration.** The model has no idea how long
  silence has lasted, because it reads no clock.
- **One thread per contact.** A person reached on two channels is two records, and the
  model will not notice they are the same person.
- **Four axes, four statuses.** `AMBIGUOUS` covers everything from "polite but vague" to
  "contradicted themselves"; the distinction lives in the evidence text, which no rule
  reads.
- **`next_action` is a permission, not a plan.** `FOLLOW_UP` says a follow-up is allowed;
  it does not say it is a good idea, and nothing here writes or sends one.
- **Evidence is not verified.** The rule is that a judgement cites a message; nothing
  checks that the citation says what the summary claims.
