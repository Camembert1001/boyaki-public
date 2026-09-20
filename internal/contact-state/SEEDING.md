# Seeding the local contact store

> This file describes conversation **shapes** and the mechanics of recording them. It
> holds no contact data, and it must never be edited to hold any: names, handles,
> addresses, thread ids and message ids belong in `contacts.local.json`, which is
> gitignored, and nowhere else in this repository.

The discovery engine can only refuse to burn a prospect it can recognize. Until the local
store exists and carries identity evidence, every candidate the engine finds reads
`UNCHECKED`, and `UNCHECKED` can never reach `READY_FOR_REVIEW`. Seeding the store is
therefore not bookkeeping — it is the thing that turns the engine on.

## What to do

```
cp internal/contact-state/contacts.template.json internal/contact-state/contacts.local.json
$EDITOR internal/contact-state/contacts.local.json
node internal/contact-state/state.mjs internal/contact-state/contacts.local.json --strict
```

`--strict` exits non-zero if any record contradicts itself. Then check the store can
actually answer the question discovery asks it:

```
node internal/distribution-scanner/prospect.mjs <workspace> \
  --contacts internal/contact-state/contacts.local.json
```

The header line reports `N contact(s), M with identity evidence`. **If `M` is less than
`N`, the engine will not show anybody as never contacted** — not for the unindexed
contacts, for *anybody*. A contact nothing can recognize is a contact nothing can exclude,
and excluding every contact is what "this party is new" means.

`contacts.local.json` and `CHECKPOINT.local.md` are gitignored, and a test asserts both
rules are present and that no tracked file here carries contact data. The store lives on
the operator's machine; a throwaway environment is not persistence, and a store rebuilt
in one is gone when it ends.

## The identity block

Every contact takes an optional `identity` block. Fill it in for every contact, with
whatever the channel already shows in public:

| Field | Holds | Matches when |
| --- | --- | --- |
| `github_logins` | a login, without `@` | a candidate's repository owner is that login |
| `repositories` | `owner/name` | a candidate is that repository |
| `aliases` | a project or handle as it is written | a candidate declares the same name, folded to lower case and NFKC |
| `domains` | a bare host | a candidate's URL is on that host |
| `emails` | an address | a locally-recorded address for the candidate is the same |
| `manual_links` | a candidate id from a manifest | a human decided by hand that this candidate is this contact |

Rules the matcher follows, and will not be talked out of:

1. **Only exact equality matches.** A similar personal name, a shared organization, a
   username fragment inside another username, a bare repository name without its owner,
   or the same kind of project never matches. Each of those raises a hand instead, and a
   raised hand routes the candidate to a human — it never resolves in either direction.
2. **An alias made only of common words is a category, not a name.** `Game Project`
   matches nothing.
3. **Two contacts may claim the same identifier.** One party reached on two channels is
   two records by design; a candidate matching both resolves to both, and the most
   restrictive state wins.
4. **The candidate id alone is not an identity.** It is a name discovery invented for a
   directory, so "no manual link points at it" is not "this party is not in the store".

## Getting the events right

Record what happened, not what it meant. The fold does the rest.

| If this happened | Record |
| --- | --- |
| we sent a first message | `OUTREACH_SENT` |
| we asked something specific | `QUESTION_SENT` with `waiting_for`, and `PAYER_ANSWER` for anything about price |
| a person wrote back | `INBOUND_REPLY` |
| a robot acknowledged the ticket | `INBOUND_REPLY` with `"human": false` |
| we told them they need not answer | `REPLY_WAIVED` |
| the thread ended | `CONVERSATION_ENDED` with the `direction` it ended from |
| they asked not to be contacted again | `OPT_OUT` |
| we learned something they said | `VALIDATION_RECORDED`, citing the message |

Three of these carry most of the risk:

**An automated receipt is not a reply.** `"human": false` records the message and touches
nothing else. It cannot set `human_reply`, cannot clear a wait, and cannot reopen a thread
a person ended. A support autoresponder read as an answer is a contact spent for nothing.

**A polite answer about price is not a yes.** Anything short of an explicit "yes, I would
pay that" is `AMBIGUOUS` on the payer axis, with the quote as evidence. `POSITIVE` there
is the single claim this whole pipeline exists to earn, and inflating it would make every
downstream number meaningless.

**Nothing may be recorded as a judgement without a citation.** Any status other than
`UNKNOWN` requires at least one evidence entry, and `quote_or_summary` is what the person
said, not what we concluded from it. Silence is never evidence; it stays `UNKNOWN`.

## The six shapes in the template

Each entry in `contacts.template.json` is one shape a YN0 thread has actually taken. Match
each real thread to the shape it has, copy that entry, and replace the placeholders.

| Shape | The situation it describes | Where it ends up |
| --- | --- | --- |
| `validated-then-closed-shape` | answered on three axes, nothing explicit about price, then ended the thread | `CLOSED`, reopen on inbound only, no follow-up permitted |
| `one-axis-answered-nothing-outstanding-shape` | answered one question; we released them from answering more | nothing outstanding, no follow-up owed |
| `awaiting-first-reply-shape` | we wrote, nobody has answered yet | `AWAITING_REPLY`; the only correct action is to wait |
| `automated-receipt-only-shape` | a ticket system acknowledged us and no person has written | still `AWAITING_REPLY`, and `human_reply` stays false |
| `waived-then-closed-shape` | they did not know who we were; we explained, waived the questions and closed | `CLOSED`, reopen on inbound only |
| `payer-question-outstanding-shape` | the price question is sent and unanswered | `VALIDATING` on the payer axis; blocks re-asking that same prospect/contact |

Outstanding-axis protection is **prospect/contact-scoped**. If Prospect A is waiting on a payer answer, the engine must not ask Prospect A the payer question again. That outstanding answer does **not** block an independently identity-checked `NO_MATCH` Prospect B from proceeding through the normal gates. Store-wide outstanding-axis values may be reported for visibility, but they are not candidate gates.

## What the store does not do

It sends nothing. It opens no issue, writes no comment, holds no credential and makes no
network call. Every message on the wire is still written and sent by a person; this only
says what state each contact is in and which of six actions is permitted. `READY_FOR_REVIEW`
downstream means "a human should read this", and never anything more.
