# YN0 Checkpoint

Read this file first. It is the YN0 recovery point: a session that has lost every
ChatGPT or Claude conversation log can restore YN0's current position from this file
plus `internal/yn0/contacts.json`.

This checkpoint is YN0 only. BOYAKI has its own state and none of it belongs here.

## Objective

Validate the real demand and willingness to pay for **mechanical localization
preflight** among working game localizers and localization workflows.

## Current hypothesis

The value is not translation quality. It is mechanical regression caught before LQA
or before import:

- missing / empty target strings
- placeholder mismatch
- control-token mismatch
- suspicious whitespace and formatting

## Current validation

Problem:

evidence あり — Atlos confirmed the reported Japanese keys were genuinely missing
translations rather than an intentional English fallback; OyasumiVR's maintainer
confirmed the missing `{deviceName}` placeholder as a real defect.

Usefulness:

evidence あり — Atlos acted on the findings; OyasumiVR accepted and shipped the fix
in #340 and stated an intention to add more automated checks; Banzai Escape 2
confirmed a mechanical preflight would be useful and asked about TXT support.

Payer:

NOT VALIDATED

No contact has given an evidence-backed yes to the $5 question. One contact was asked
and gave an explicit non-answer (AMBIGUOUS). Two contacts have an outstanding payer
question. Everyone else is UNKNOWN, which means *no evidence*, not *reply pending*.
`internal/yn0/state.mjs` reports `payer validated 0/6 countable`, and a test asserts
that number stays 0 until real evidence lands.

## Contacts

Derived live from the state machine. Regenerate with
`node internal/yn0/state.mjs`.

| Contact | Conversation | Human reply | Problem | Usefulness | Payer | next_action |
| --- | --- | --- | --- | --- | --- | --- |
| XenoAisam — XenoAisam Studio (Banzai Escape 2) | CLOSED | yes | UNKNOWN | POSITIVE | AMBIGUOUS | DO_NOT_CONTACT |
| Muraoka — Collet Game Translation | STALLED | yes | UNKNOWN | UNKNOWN | UNKNOWN | DO_NOT_CONTACT |
| Atlos maintainers — Atlos (Open Endfield Map) | AWAITING_REPLY | yes | POSITIVE | POSITIVE | UNKNOWN | WAIT |
| Tashiro — Across | AWAITING_REPLY | no | UNKNOWN | UNKNOWN | UNKNOWN | WAIT |
| Jonnil Games — Jonnil Games (Sticky Paws) | AWAITING_REPLY | no | UNKNOWN | UNKNOWN | UNKNOWN | WAIT |
| Igara Studio support — Igara Studio (Aseprite) | AWAITING_REPLY | no (auto-ack only) | UNKNOWN | UNKNOWN | UNKNOWN | WAIT |
| OyasumiVR maintainer — OyasumiVR | OBSERVE | yes | POSITIVE | POSITIVE | UNKNOWN | OBSERVE |

**Banzai Escape 2 / XenoAisam Studio.** Human reply received. Uses a custom TXT
format no adapter reads. Mechanical preflight usefulness POSITIVE; interest in a
TXT-capable version POSITIVE. Asked the $5 payer question and got
*"That. I don't know. I cannot answer YEs or No."* — recorded as **AMBIGUOUS** with
the quote as evidence, not as a pending answer. Thank-you sent, conversation CLOSED,
re-open on inbound only.

**Muraoka / Collet Game Translation.** Outreach sent; replied *"Do I know you?"*; we
explained identity and purpose and then wrote *"No need to answer the original
questions if you'd rather not."* No validation answers were given. Every dimension is
UNKNOWN **because there is no evidence**, and the questions were explicitly released,
so nothing is owed to us. This contact is STALLED, not awaiting a reply. It is the
case the state machine was built to make unrepresentable.

**Atlos / Open Endfield Map.** Human reply confirmed real missing Japanese keys — the
English fallback was a missing translation, not a deliberate choice. Problem and
usefulness POSITIVE. A locale schema and checker already exist in the project but are
not connected to release checks; the follow-up asking *why* that connection was never
made has been sent and its answer is genuinely outstanding. This is the only contact
with both a human reply on record and a live WAIT.

**Tashiro / Across.** Payer validation email sent, no human reply yet.

**Sticky Paws / Jonnil Games.** Outreach sent, no human reply yet. Open questions:
whether the `{br}` differences are intentional, and whether the check is useful.

**Aseprite / Igara Studio.** Outreach sent; the only thing that came back was an
automated support receipt. `human_reply` is **false** and `last_inbound_at` stays
null — an auto-acknowledgement is not a reply. Open questions: whether the
placeholder mismatch is real, and whether the check is useful.

**OyasumiVR.** GitHub issue #339 reported a missing `{deviceName}` placeholder; the
maintainer accepted the fix in #340 and said *"I will likely be adding more automated
checks soon."* Problem and usefulness POSITIVE; payer UNKNOWN. It is a free product,
so it **does not count toward payer validation** — the store marks this with
`counts_toward_payer_validation: false` and a test proves that even a hypothetical
yes from this contact would not move the payer count.

## Technical state

- distribution scanner あり (`internal/distribution-scanner/`)
- adapter architecture あり
- JSON adapter のみ
- `raw file → adapter → normalized entries → checker`
- CSV / PO / YAML etc. 未実装
- CI / release gate 未実装

PR #11:
`refactor(scanner): separate file adapters from the checker`

## Current hypotheses under test

**A.** Will a freelance or in-house localization worker pay $5 one-time for this?

**B.** Even where a checker already exists, is there value in the workflow gap — the
checker never being connected to CI or release?

B is waiting on the Atlos answer.

## Decision gates

- **payer YES** → add only the file-format adapters actually required by the people
  who said yes, then re-validate.
- **Atlos confirms CI/release integration pain** → open the Localization Regression
  Gate hypothesis as a separate validation track.
- **no payer evidence** → do not expand the product speculatively.

## Do not do

- speculative adapters
- GUI
- SaaS
- billing
- automatic outreach
- automatic follow-up
- re-selling to a CLOSED contact
- CI / release gate before validation
- mixing YN0 and BOYAKI state

## How to restore this state in a new session

1. Read this file.
2. Run `node internal/yn0/state.mjs` — the current contact table, derived, with the
   rule that produced each `next_action`.
3. Run `node --test internal/yn0/tests/state.test.mjs` to confirm the model still
   holds the recorded facts.
4. Read `internal/yn0/README.md` for the state model itself, and
   `internal/yn0/contacts.json` for the stored evidence.

Nothing in this repository sends mail, opens issues or contacts anyone. Every outbound
message is a human decision, and `next_action` is a recommendation to a human.

## Known gaps in this record

- `last_inbound_at`, `last_outbound_at` and `last_auto_ack_at` are `null` for every
  current contact: no message id or timestamp was captured while those exchanges
  happened. Evidence `ref` is likewise null except for the OyasumiVR GitHub links.
  The derivation falls back to conversation state for those contacts, which is why
  the ordering facts are recorded as state rather than dates.
- `channel` is `EMAIL` for every contact except OyasumiVR (`GITHUB_ISSUE`). It was
  taken from the shape of the outreach programme, not from a per-thread record.
- `problem` is UNKNOWN for Banzai Escape 2: the reply establishes usefulness and TXT
  interest, and no statement about the underlying problem was recorded.
