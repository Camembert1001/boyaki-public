# YN0 Distribution Scanner (internal MVP)

Internal tooling for the Japanese UI Mechanical Preflight experiment. It reduces manual
prospect discovery by scanning a **local** checkout for EN/JA locale pairs, running the
same mechanical checks the public [JP UI Preflight](../../yn0-jp-ui-preflight/) runs, and
classifying each pair by how workable the findings look.

On top of that sits [**Prospect Discovery**](#prospect-discovery) (`prospect.mjs`), which
takes the same scan and narrows a workspace of candidate repositories down to the few
worth a person's attention — checking each one against the localization assets it holds,
the confidence of its findings, and [`internal/contact-state/`](../contact-state/).

**This is not a product feature.** It does no outreach, sends no email, opens no issues or
comments, drives no browser, handles no credentials, and makes no network call. It is
read-only: it reports, and never rewrites a locale file. Its most positive verdict is
"a person should look at this", and nothing downstream of that verdict exists here.

## Usage

One command, one local path:

```
node internal/distribution-scanner/scan.mjs internal/distribution-scanner/fixtures
```

Any local checkout works the same way:

```
node internal/distribution-scanner/scan.mjs ../some-cloned-project
```

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--format <text\|json>` | `text` | Output format on stdout |
| `--out <file>` | — | Also write the JSON report to a file |
| `--samples <n>` | `5` | Sample findings shown per pair |
| `--high-fit-max <n>` | `10` | Most findings still counted `HIGH_FIT` |
| `--review-max <n>` | `50` | Most findings still counted `REVIEW` |
| `--noisy-blank-ratio <r>` | `0.25` | Untranslated share that forces `TOO_NOISY` |
| `-h`, `--help` | — | Show usage |

Exit codes: `0` success, `1` scan failure (e.g. missing path), `2` bad arguments.

## Sample output

```
$ node internal/distribution-scanner/scan.mjs internal/distribution-scanner/fixtures/placeholder-set
YN0 Distribution Scanner - internal/distribution-scanner/fixtures/placeholder-set
1 EN/JA pair - HIGH_FIT 1 - CLEAN 0 - REVIEW 0 - TOO_NOISY 0

[HIGH_FIT] translations/strings-en.json <-> translations/strings-ja.json
  keys: EN 6 - JA 6 - findings 1 (classifying 1, advisory 0, untranslated 0, 0.0%)
  rules: placeholder-set-mismatch 1
  reason: 1 classifying finding within the 1-10 high-fit band.
  - ERROR placeholder-set-mismatch [greeting] Placeholder sets differ (missing in JA: {{name}}; not in EN: {{user}}).
```

Scanning the whole fixture tree reports every bucket at once:

```
$ node internal/distribution-scanner/scan.mjs internal/distribution-scanner/fixtures
YN0 Distribution Scanner - internal/distribution-scanner/fixtures
9 EN/JA pairs - HIGH_FIT 6 - CLEAN 2 - REVIEW 0 - TOO_NOISY 1
...
[HIGH_FIT] advisory-noise/lang/en.json <-> advisory-noise/lang/ja.json
  keys: EN 15 - JA 15 - findings 13 (classifying 1, advisory 12, untranslated 0, 0.0%)
  rules: edge-whitespace 12 - placeholder-multiplicity-mismatch 1
  reason: 1 classifying finding within the 1-10 high-fit band. 12 advisory findings reported but not classified.
...
[TOO_NOISY] too-noisy/i18n/en/common.json <-> too-noisy/i18n/ja/common.json
  keys: EN 12 - JA 10 - findings 10 (classifying 10, advisory 0, untranslated 10, 83.3%)
  rules: empty-ja 8 - missing-ja 2
  reason: 10 of 12 EN keys have no Japanese value (83.3% >= 25.0%); the locale looks incomplete rather than defective.
```

The machine-readable form carries the same data, plus the thresholds the run used:

```
$ node internal/distribution-scanner/scan.mjs internal/distribution-scanner/fixtures/placeholder-multiplicity --format json
{
  "schema": "yn0-distribution-scanner-report-v1",
  "root": "internal/distribution-scanner/fixtures/placeholder-multiplicity",
  "thresholds": { "highFitMax": 10, "reviewMax": 50, "noisyBlankRatio": 0.25 },
  "sampleLimit": 5,
  "rules": { "edge-whitespace": "WARN", "...": "..." },
  "advisoryRules": [ "edge-whitespace" ],
  "pairCount": 1,
  "summary": { "HIGH_FIT": 1, "CLEAN": 0, "REVIEW": 0, "TOO_NOISY": 0 },
  "pairs": [
    {
      "en": "locale/en_GB.json",
      "ja": "locale/ja_JP.json",
      "enKeyCount": 3,
      "jaKeyCount": 3,
      "totalFindings": 1,
      "classifyingFindings": 1,
      "advisoryFindings": 0,
      "findingsByRule": { "placeholder-multiplicity-mismatch": 1 },
      "blankFindings": 0,
      "blankRatio": 0,
      "classification": "HIGH_FIT",
      "reason": "1 classifying finding within the 1-10 high-fit band.",
      "samples": [
        {
          "severity": "INFO",
          "rule": "placeholder-multiplicity-mismatch",
          "key": "defeat",
          "detail": "Same placeholder set, different repeat counts ({0} EN x1 / JA x2). Natural Japanese may legitimately repeat a placeholder."
        }
      ],
      "notes": []
    }
  ],
  "skipped": []
}
```

The report carries no timestamp and no randomness, so two runs over the same tree are
byte-identical.

## Locale discovery

JSON only today — it is the only registered [file adapter](#adding-a-file-adapter), and
discovery ignores every extension no adapter claims. A file is treated as a locale
when an `en` / `ja` tag — optionally with a region, e.g. `en-US`, `ja_JP` — appears either
in its filename or in a directory segment:

- `en.json` / `ja.json`
- `en-US.json` / `ja-JP.json`, `en_GB.json` / `ja_JP.json`
- `strings-en.json` / `strings-ja.json`, `en.messages.json` / `ja.messages.json`
- `locales/en/common.json` / `locales/ja/common.json` (and `locale/`, `lang/`,
  `languages/`, `translations/`, `messages/`, `resources/`, or anywhere else)

Flat and nested JSON both work; nested objects and arrays flatten to dotted keys
(`menu.save`, `tips.0`). Only leaf scalars count as strings, so structure is never
compared as content. `.git`, `node_modules`, `dist`, `build` and similar directories are
skipped. When a group holds several candidates (`en.json` *and* `en-US.json`), the
region-less file is scanned and the alternates are listed under the pair's `notes`.

## Adding a file adapter

The checks never see a file. Reading is one replaceable layer:

```
raw file -> file adapter -> normalized entries -> mechanical checks -> findings
```

A **normalized entry** (`lib/entries.mjs`) is `{key, value, location?}`: the identifier the
string has inside its own file (dotted JSON path today, a msgid or row id for some other
format), the string itself, and an optional adapter-defined position in the raw file. Source
and target entries are matched by `key`; `location` is carried through pairing untouched for a
line-oriented format to use, and no check reads it.

An **adapter** (`lib/adapters/`) is a plain object:

| Field | Meaning |
| --- | --- |
| `id` | short lowercase identifier, unique |
| `label` | human-readable format name, used in `skipped` reasons |
| `extensions` | lowercase extensions with the dot, each claimed by exactly one adapter |
| `parse(text)` | `{ok: true, entries}` or `{ok: false, reason}` — pure, no filesystem, never throws on malformed input |

To add one, e.g. CSV:

1. Write `lib/adapters/csv.mjs` exporting the object above as its default export.
2. Add it to `ADAPTERS` in `lib/adapters/index.mjs`. Discovery picks up the new extension
   from there, and the scanner picks the adapter by extension.
3. Add a `csv` entry to `tests/adapter-fixtures.mjs` — one sample file, the entries `parse`
   must return, and a few malformed texts it must reject. The contract test
   (`every registered file adapter satisfies the adapter contract`) fails until it exists,
   and then exercises the new adapter automatically.
4. Optionally add a `fixtures/<scenario>/` directory in the new format for an end-to-end
   scan; note that the fixture-bucket test pins the current tree, so extend its expectations
   in the same change.

Nothing in `lib/checks.mjs`, `lib/discover.mjs` or `lib/scanner.mjs` changes. Files of
different formats never pair with each other: a pair's group key includes the extension, so
`en.json` pairs with `ja.json`, never with `ja.csv`.

## Mechanical checks

These mirror the public Preflight so that a scanner finding is the same claim the public
tool would make:

| Rule | Severity | Fires when |
| --- | --- | --- |
| `missing-ja` | ERROR | Key exists in EN, absent in JA |
| `empty-ja` | ERROR | JA value is empty or whitespace-only |
| `placeholder-set-mismatch` | ERROR | A placeholder token appears on only one side |
| `edge-whitespace` | WARN | JA value has leading or trailing whitespace |
| `halfwidth-katakana` | WARN | JA value contains U+FF66–U+FF9F |
| `fullwidth-space` | WARN | JA value contains IDEOGRAPHIC SPACE U+3000 |
| `placeholder-multiplicity-mismatch` | INFO | Same token set, different repeat counts |

Placeholder extraction uses the public tool's pattern verbatim
(`{{name}}`, `{name}`, `{0}`, format-like `{0:0.#}`, `%s` / `%d` / `%f`, indexed `%1$s`).
A test asserts the pattern still matches the one embedded in
`yn0-jp-ui-preflight/index.html`, so drift fails the suite rather than going unnoticed.

The one intentional divergence: the Preflight's single `placeholder-mismatch` rule is
split into the two placeholder rules above. Their union is exactly the Preflight's
condition — no case is gained or lost, it is only labelled more precisely.

Keys present only in JA are checked on the JA side and are never reported as extra keys,
matching the Preflight.

## Prospect classification

This is the *scanner's* per-pair bucket. The repository-level verdicts a reviewer reads —
`READY_FOR_REVIEW` / `HUMAN_REVIEW` / `IGNORE` — are decided a layer up, in
[Prospect Discovery](#prospect-discovery), which uses these buckets as one input among
several.

### Classifying vs advisory findings

Buckets count **classifying** findings, not every finding. One rule is *advisory*:

| Advisory rule | Why |
| --- | --- |
| `edge-whitespace` | Projects pad strings on purpose for concatenation and layout |

Advisory findings are still detected, still reported, still sampled, and still counted in
`totalFindings` — they simply do not move the bucket. Each pair reports the split as
`classifyingFindings` and `advisoryFindings`, and the run reports `advisoryRules`.

This exists because of PocketRoles: 47 of its 1,069 strings are deliberately padded, and
counting those 47 as prospect evidence buried its one genuine finding and pushed a 1-finding
repository out of `HIGH_FIT` into `REVIEW`. The issue's own false-positive discipline says
edge whitespace may be intentional; the classifier now behaves the way that paragraph reads.

`halfwidth-katakana` and `fullwidth-space` are **not** advisory. Those are defect claims
about the Japanese text, not house style, so they still classify.

### Order

Evaluated in order, per pair. An incomplete locale is judged before raw finding counts,
because hundreds of untranslated strings are a stalled translation effort, not a review
queue.

1. `REVIEW` — the EN locale has no string entries to compare.
2. `TOO_NOISY` — untranslated share (`missing-ja` + `empty-ja`, over EN keys) reaches
   `--noisy-blank-ratio`.
3. `TOO_NOISY` — classifying findings exceed `--review-max`.
4. `CLEAN` — no classifying findings. If advisory findings were reported, the reason says
   so, so `CLEAN` never implies the padding went unseen.
5. `HIGH_FIT` — classifying findings within `1 .. --high-fit-max`.
6. `REVIEW` — anything in between.

**These thresholds are a triage heuristic, not product truth.** They are CLI options
precisely so they can be retuned against real repositories without editing code.

## False-positive discipline

- The scanner reports; it never auto-corrects. A test re-reads every fixture after a scan
  to prove the tree is untouched.
- A placeholder the Japanese repeats more often than the English is **INFO**, not an
  error. Natural Japanese legitimately repeats `{0}`; that was the PocketRoles case.
- Edge whitespace is **WARN**, its detail says the padding may be intentional for
  concatenation or layout, and it is advisory: it is reported but does not decide the
  bucket. Some projects pad deliberately, and their house style should not read as 47
  reasons to contact them.
- Set mismatch and multiplicity mismatch are separate rules so a reviewer can tell
  "the translator dropped a token" from "the translator wrote natural Japanese".

## Fixtures

`fixtures/` holds one directory per scenario, each also exercising a different locale
naming convention:

| Fixture | Covers | Expected |
| --- | --- | --- |
| `clean/locales/` | clean pair, nested JSON | `CLEAN` |
| `missing-empty/lang/` | missing key + empty value, `en-US`/`ja-JP` | `HIGH_FIT` |
| `placeholder-set/translations/` | token set mismatch, `strings-en`/`strings-ja` | `HIGH_FIT` |
| `placeholder-multiplicity/locale/` | multiplicity-only mismatch, `en_GB`/`ja_JP` | `HIGH_FIT` |
| `edge-whitespace/messages/` | intentional-looking padding on both sides | `CLEAN` (3 advisory) |
| `advisory-noise/lang/` | PocketRoles shape: advisory padding around one real finding | `HIGH_FIT` |
| `halfwidth-katakana/resources/` | U+FF66–U+FF9F | `HIGH_FIT` |
| `ideographic-space/languages/` | U+3000 | `HIGH_FIT` |
| `too-noisy/i18n/` | incomplete locale, directory-based discovery | `TOO_NOISY` |

Codepoints under test are written as `\uXXXX` escapes in the fixtures so the intent is
readable in a diff.

## Prospect Discovery

The scanner answers "is this EN/JA pair defective?". That is one input to a different
question, which is the one that actually costs something:

> Is this repository worth a person's attention, before any person spends attention on it?

`prospect.mjs` is that second question. It wraps the scanner without changing it, and
runs the pipeline the scanner was always the middle of:

```
repository
  -> localization asset discovery      (lib/assets.mjs)
  -> EN/JA pair detection              (lib/discover.mjs, unchanged)
  -> mechanical scan                   (lib/scanner.mjs, unchanged)
  -> finding confidence / noise        (lib/confidence.mjs)
  -> repository suitability evidence   (lib/candidates.mjs + lib/metadata.mjs)
  -> contact-state check               (lib/contact-link.mjs)
  -> candidate classification          (lib/candidates.mjs)
  -> human review
```

**The pipeline ends at "human review" and there is no step after it.** Nothing in it
sends mail, opens an issue, writes a comment, fills in a form, drives a browser, holds a
credential or makes a network call. A test asserts the absence rather than the intention:
no module under `lib/` may so much as reference `node:http`, `fetch(`, an SMTP library or
`api.github.com`. The output is a reading list, and `READY_FOR_REVIEW` means "a person
should look at this", never "contact these people".

### The constraint this is built around

Contacts are a finite resource. The metric is not candidates produced, it is **information
gain per contact** — which makes the success condition the number of weak candidates
*dropped* before a human reads them. Ten of the eighteen fixture candidates are dropped,
six are held for a human decision, and two are proposed for review; a change that raises
the last number without raising the evidence behind it is a regression, not an improvement.

### Usage

```
node internal/distribution-scanner/prospect.mjs <workspace> [options]
```

Each immediate subdirectory of `<workspace>` is one candidate repository; `--single`
treats the path itself as one. The two inputs that matter are local files:

```
node internal/distribution-scanner/prospect.mjs ~/prospects \
  --contacts internal/contact-state/contacts.local.json \
  --metadata internal/distribution-scanner/prospects.local.json
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--single` | — | Treat the path itself as one repository |
| `--contacts <file>` | — | contact-state store to check against |
| `--metadata <file>` | — | External prospect metadata (`yn0-prospect-metadata-v1`) |
| `--asking <axis>` | — | Validation axis this round would ask about |
| `--verdict <V>` | — | Report only `READY_FOR_REVIEW` / `HUMAN_REVIEW` / `IGNORE` |
| `--format <text\|json>` | `text` | Output format on stdout |
| `--out <file>` | — | Also write the JSON report to a file |
| `--samples <n>` | `5` | Findings shown per prospect |
| `--min-completeness <r>` | `0.85` | Locale completeness floor |
| `--min-high-confidence <n>` | `1` | High-confidence findings required |
| `--max-noise-ratio <r>` | `0.9` | Share of citable findings that may be intentional-risk |

Without `--contacts`, **no candidate can reach `READY_FOR_REVIEW`**. "We have not written
to them" is a claim about a store; not having looked at the store is not the same claim.

### Localization asset discovery

`discover.mjs` only sees extensions a registered adapter claims — correctly, because the
checker can only check what it can parse. For prospect discovery that is the wrong answer:
a repository whose Japanese lives in `locale/ja.po` is not a repository without Japanese,
it is one we cannot check yet. So `assets.mjs` inventories everything and labels it:

| Support | Meaning |
| --- | --- |
| `SUPPORTED` | a registered file adapter claims the extension; the checker reads it |
| `DETECTED_BUT_UNSUPPORTED` | the asset exists and nothing here parses it |

Recognised: JSON, CSV, TSV, YAML, XML, INI, plain text, Java properties, Gettext PO,
XLIFF, Flutter ARB, Fluent, Apple `.strings`, `.NET` `.resx`. A file counts as an asset
when its extension exists only for localization (`.po`, `.xliff`, `.arb`, `.ftl`,
`.strings`, `.resx`), or when the path carries locale evidence — a language tag in the
filename, a language tag inside a locale directory, or a locale directory itself.
`package.json` and `data/items.json` are not localization assets and `src/it/Main.xml` is
not Italian.

**`DETECTED_BUT_UNSUPPORTED` is a terminal state, not a backlog.** Nothing here parses a
PO, CSV or YAML file, and detecting one is not a step towards doing so. A format earns a
product adapter when a validation response asks for it — not when the inventory notices
it exists. Until then the right answer is "found it, cannot read it, a human decides",
which is exactly what rule 8 below says.

### Finding confidence

The seven mechanical checks are unchanged: same rules, same severities, same advisory
split. On top of them the prospect layer asks one further question, and only for
discovery:

> Would I be comfortable putting this finding in front of a stranger as the reason I am
> writing to them?

That is not the same question as "is this a defect?", and Atlos is why it is asked
separately: a checker whose findings a maintainer can wave away as intentional cannot be a
CI or release gate — and a finding a maintainer can wave away is not worth one of a finite
number of first contacts.

| Band | Rules | Why |
| --- | --- | --- |
| `HIGH_CONFIDENCE` | `placeholder-set-mismatch`, `halfwidth-katakana` | a user sees the consequence and no house style explains it away |
| `INTENTIONAL_RISK` | `edge-whitespace`, `fullwidth-space`, `placeholder-multiplicity-mismatch` | real observations a project may well have written on purpose |
| `INCOMPLETE_LOCALE` | `missing-ja`, `empty-ja` | "not finished yet" — true, and not something to write to anyone about |

Severity and confidence are orthogonal, and deliberately so. `halfwidth-katakana` is a
WARN and high-confidence, because half-width katakana in a UI string is a legacy encoding
artifact rather than a style; `fullwidth-space` is the same severity and is not, because
U+3000 is ordinary Japanese typography. A rule with no band is treated as
`INTENTIONAL_RISK`, so a new check cannot raise a candidate to `READY_FOR_REVIEW` by
accident — and a test fails until the new check is banded on purpose.

Two derived numbers fall out of the bands:

- **locale completeness** — `1 - untranslated/EN keys`. Governs "is this locale finished
  enough to judge?".
- **noise ratio** — the share of *citable* findings that are not high-confidence,
  `1 - high/(high + intentional-risk)`. Incomplete-locale findings are excluded on
  purpose: completeness already governs them, and folding them in here would let a
  half-finished locale bury two genuine placeholder bugs.

### Repository suitability evidence

Some things worth knowing are not in the files: whether anyone still maintains the
repository, and whether there is a public route to its maintainers at all. Neither is
fetched. Wiring a GitHub client into the scanner core to answer "is this repo alive?"
would trade away the property that makes the core safe — filesystem-only, no credentials,
no network — for a field a human can type. So the shape is the opposite: an optional
input file, validated on load, absent by default.

```json
{
  "schema": "yn0-prospect-metadata-v1",
  "prospects": {
    "some-repository-directory": {
      "aliases": ["a name this project is also known by"],
      "activity": "ACTIVE",
      "activity_evidence": "commits this month",
      "public_contact_route": "GITHUB_ISSUE",
      "contact_route_evidence": "issues open, template present",
      "contact_ids": [],
      "notes": "free text for the reviewer"
    }
  }
}
```

`activity` is `ACTIVE` / `MAINTAINED` / `DORMANT` / `UNKNOWN`; `public_contact_route` is
`GITHUB_ISSUE` / `GITHUB_DISCUSSION` / `PUBLIC_EMAIL` / `OTHER` / `NONE` / `UNKNOWN`. An
absent field is never guessed — it reads `UNKNOWN`, and `UNKNOWN` routes to a human rather
than assuming the best. An unknown *field name* is an error, so `contact_id` instead of
`contact_ids` fails loudly rather than silently meaning "nobody checked".

### contact-state connection

[`internal/contact-state/`](../contact-state/) stays the single source of truth for "what
state is this contact in?". This layer reads it and stores nothing: no contact record is
created, copied, summarised into the report, or written back. What crosses the boundary is
**one enum per prospect** — a *posture* — plus the contact ids it came from. A test asserts
the report contains no contact's name or organization.

The direction is one-way. Discovery asks contact-state a question; it never tells
contact-state anything, and it never reimplements the state machine — every posture is a
fold of `derive()`'s own `next_action` and the stored conversation, so a change to the
contact model surfaces here instead of being silently contradicted.

| Posture | Reached when |
| --- | --- |
| `DO_NOT_CONTACT` | `reopen_condition = NEVER` — they opted out |
| `CLOSED` | the conversation is over |
| `INBOUND_ONLY` | closed, reopens only if they write to us |
| `ALREADY_CONTACTED` | a live thread exists, or we owe them a reply |
| `AWAITING_REPLY` | we asked and the answer is outstanding |
| `NEEDS_HUMAN` | contact-state itself routes the record to `REVIEW` |
| `UNRESOLVED` | the prospect names a contact id the store does not hold |
| `AMBIGUOUS_MATCH` | the prospect claims no contact, but a stored one looks like the same party |
| `UNCHECKED` | no store was consulted, or the prospect declared no contact link |
| `NEVER_CONTACTED` | store consulted, nothing matched, nothing looked close |

Postures are ordered most-restrictive-first: a prospect resolving to two threads, one of
them opted out, is opted out.

`contact_ids: []` is a *positive* claim — "the store was checked and holds nothing for this
party" — and is the only route to `NEVER_CONTACTED`. Omitting the field is a different
claim, `UNCHECKED`, and cannot produce a candidate for review. Absence of evidence is not
evidence of absence.

`AMBIGUOUS_MATCH` is the identity guard. When a prospect declares no contact, its directory
name and aliases are compared against every stored id, name, organization and thread
reference; any shared uncommon token raises a hand. The matcher is deliberately crude —
it decides nothing, it only refuses to let "never contacted" pass unchecked when somebody
in the store looks like the same party.

One Prospect Burn rule belongs to no single prospect: while somebody already owes us an
answer on a validation axis, opening the same question with a second stranger buys no
information we are not already about to get. `--asking <axis>` turns that into rule 16 —
candidates are held while the same question is outstanding anywhere in the store.

### Candidate classification

Three verdicts, decided by an ordered rule table. The first matching rule wins, and its
number and text are reported, so "why was this dropped" always has a rule number as its
answer. Every rule fails closed: where the machine is unsure the answer is `HUMAN_REVIEW`
or `IGNORE`, never `READY_FOR_REVIEW`.

| # | Condition | Verdict |
| --- | --- | --- |
| 1 | contact opted out | `IGNORE` |
| 2 | conversation closed (reopens on inbound, or not at all) | `IGNORE` |
| 3 | a thread already exists / an answer is outstanding | `IGNORE` |
| 4 | contact identity unresolved, ambiguous, or flagged by the model | `HUMAN_REVIEW` |
| 5 | repository is dormant | `IGNORE` |
| 6 | no public contact route | `IGNORE` |
| 7 | no localization assets of any known format | `IGNORE` |
| 8 | assets exist, in no format the checker can read | `HUMAN_REVIEW` |
| 9 | assets are readable but form no EN/JA pair | `IGNORE` |
| 10 | locale too incomplete to judge | `IGNORE` |
| 11 | nothing but clean strings and untranslated keys | `IGNORE` |
| 12 | findings exist, none survives "could this be on purpose?" | `HUMAN_REVIEW` |
| 13 | a defensible finding drowned in ones that are not | `IGNORE` |
| 14 | contact history never checked | `HUMAN_REVIEW` |
| 15 | repository activity unknown | `HUMAN_REVIEW` |
| 16 | the same validation question is already outstanding elsewhere | `HUMAN_REVIEW` |
| 17 | otherwise | `READY_FOR_REVIEW` |

Read as prose: `READY_FOR_REVIEW` needs a readable EN/JA pair, a locale complete enough to
judge, at least one high-confidence finding that is not buried, a known-alive repository
with a public route, and a contact store that was actually consulted and came back empty.
Anything a human has to settle — an unresolved identity, an unreadable format, findings
that might all be intentional, missing metadata — is `HUMAN_REVIEW`. Everything else is
dropped with its reason.

A test walks all ten postures against the strongest possible evidence and asserts that
only `NEVER_CONTACTED` can produce `READY_FOR_REVIEW`. `DO_NOT_CONTACT` reaching a review
queue is the failure this table exists to make impossible.

### Prospect fixtures

`prospect-fixtures/` holds one invented workspace, one synthetic contact store and one
metadata file — one candidate directory per rule in the table above:

| Candidate | Shape | Verdict (rule) |
| --- | --- | --- |
| `opted-out` | strong findings, contact opted out | `IGNORE` (1) |
| `closed-conversation` | strong findings, thread closed `INBOUND_ONLY` | `IGNORE` (2) |
| `already-contacted` | strong findings, first reply outstanding | `IGNORE` (3) |
| `unknown-contact-id` | names a contact id the store does not hold | `HUMAN_REVIEW` (4) |
| `ambiguous-identity` | claims never contacted, alias matches a stored party | `HUMAN_REVIEW` (4) |
| `dormant-repo` | strong findings, repository archived | `IGNORE` (5) |
| `no-public-route` | strong findings, no public way to reach anyone | `IGNORE` (6) |
| `no-locale-assets` | no localization of any kind | `IGNORE` (7) |
| `unsupported-format-repo` | EN and JA, both in `.po` | `HUMAN_REVIEW` (8) |
| `english-side-repo` | readable locale assets, no Japanese side | `IGNORE` (9) |
| `incomplete-locale` | 50% translated, one real finding under it | `IGNORE` (10) |
| `clean-repo` | clean pair | `IGNORE` (11) |
| `intentional-risk-repo` | padding, U+3000, repeated placeholder — nothing else | `HUMAN_REVIEW` (12) |
| `noise-dominated` | one placeholder bug under twenty padded strings | `IGNORE` (13) |
| `undeclared-contact-link` | strong findings, contact link never declared | `HUMAN_REVIEW` (14) |
| `unknown-activity` | strong findings, nobody recorded whether it is alive | `HUMAN_REVIEW` (15) |
| `ready-candidate` | complete locale, one placeholder bug, store consulted | `READY_FOR_REVIEW` (17) |
| `mixed-format-candidate` | readable pair plus PO and CSV alongside | `READY_FOR_REVIEW` (17) |

**None of it is real.** Every contact id ends in `-shape`, every name is `Prospect <letter>`,
every organization starts with `Example`, and no thread reference is carried at all. A test
fails if a tracked file under `prospect-fixtures/` ever contains something shaped like an
email address or a live URL. Real contacts and real prospect metadata live in
`*.local.json` / `*.local.md`, which `.gitignore` keeps out of this repository — the same
rule [`internal/contact-state/`](../contact-state/) already enforces, and for the same reason.

## Benchmark validation

The classifier was validated against the real repositories issue #9 records, cloned at
`--depth 1` and scanned with default thresholds. Live repositories move, so the counts
below are what was observed on the day, not fixed properties of those projects.

| Repository | EN keys | Findings (classifying / advisory) | Bucket | Issue #9 expectation |
| --- | --- | --- | --- | --- |
| `ahmdkaml/BlocksBeyondTheStars` `data/locales/` | 3,962 | 5 (3 / 2) | `HIGH_FIT` | 2 placeholder mismatch candidates — both found |
| `wakayamachannel/PocketRoles` `lang/` | 1,069 | 48 (1 / 47) | `HIGH_FIT` | 1 placeholder mismatch + many intentional edge spaces |
| `toast-studio/critterdex-localisation` | 492 | 0 (0 / 0) | `CLEAN` | 492 keys, 0 current-rule findings |
| `deadlock-mod-manager/deadlock-mod-manager` `apps/desktop/src/locales/` | 2,694 | 1,995 (1,995 / 0) | `TOO_NOISY` | too noisy / incomplete |
| `chipi/orrery` `messages/` | 3,114 | 0 (0 / 0) | `CLEAN` | 3,114 keys, 0 current-rule findings |

Notes on the run:

- **PocketRoles was the reason for the advisory split.** Before it, the pair scored 48
  findings and landed in `REVIEW`; its one real finding is exactly the case the issue
  describes — `kill.worship`, `{0}` once in English and twice in natural Japanese, reported
  as INFO `placeholder-multiplicity-mismatch`. It now reads `HIGH_FIT`, with all 47 padded
  strings still listed.
- **BlocksBeyondTheStars** also surfaces two EN/JA pairs the issue does not mention
  (`data/stories/vega_protocol/locales/`, 121 keys, and
  `src/BlocksBeyondTheStars.WorldHost/Locales/`, 209 keys); both are `CLEAN`.
- **Counts have drifted since the issue was written.** Blocks Beyond the Stars read 4,530
  keys then and 4,292 across three pairs now; Deadlock read 2,504 keys / 1,630 empty then
  and 2,694 / 1,765 now. The buckets are unchanged, which is what the validation was for.
- **Orrery was independently identified and checked as `chipi/orrery`.** Its current
  `messages/en-US.json` and `messages/ja.json` each flatten to 3,114 keys and produce
  0 current-rule findings, so it lands in `CLEAN` as documented in issue #9.

The observed shapes are pinned as a test (`observed benchmark shapes land in their
documented buckets`) so a future threshold change has to restate its effect on them.

## Tests

```
node --test internal/distribution-scanner/tests/scanner.test.mjs
node --test internal/distribution-scanner/tests/prospect.test.mjs
```

No dependencies, no install step, no network. Node 22 built-ins only.

The prospect suite pins the whole rule table, walks every contact posture against the
strongest possible evidence to prove only `NEVER_CONTACTED` can reach `READY_FOR_REVIEW`,
and asserts the two properties that are easier to keep by test than by intention: that no
module here can reach a person, and that no real contact information can reach a tracked
fixture.

## Known limitations

- JSON is the only registered file adapter. CSV, `.po`, `.strings`, `.resx`, YAML and XLIFF
  are not read — adding one is an adapter, not a change to the checks (see
  [Adding a file adapter](#adding-a-file-adapter)).
- A normalized entry can carry a `location`, but nothing populates or reports one yet: the
  JSON adapter has only dotted keys, and no check or report field reads it.
- Only the seven rules above run. The public Preflight's kinsoku, display-width,
  control-character, line-break-count and punctuation-mixing checks are not ported —
  they were outside this MVP's scope.
- Thresholds are a first guess, calibrated against the repositories in **Benchmark
  validation** above. Retune them before treating a bucket as a decision.
- `advisoryRules` is a fixed list, not a CLI option. Widening it is a judgement about which
  rules are house style rather than defects, and belongs in review, not in a flag.
- Locale discovery is name-based. A project that stores Japanese in a file with no `ja`
  tag in its path is invisible to the scanner.
- One EN and one JA file per group are scanned; alternates are reported, not compared.
- `null` locale values flatten to an empty string, so a `null` JA value reads as
  `empty-ja`.

Prospect Discovery adds its own:

- **`DETECTED_BUT_UNSUPPORTED` is as far as an unsupported format goes.** The inventory
  can see a PO or CSV file; nothing reads one, and nothing is planned to until a
  validation response asks for it.
- **Activity and contact route are typed in, not fetched.** They are only as current as
  the last person who filled in the metadata file, and an empty metadata file means every
  candidate stops at `HUMAN_REVIEW`. That is the intended failure direction.
- **Identity matching is a hand-raise, not a resolver.** `AMBIGUOUS_MATCH` fires on a
  shared uncommon token; it will miss a party recorded under a wholly different name, and
  it has no idea that two directory names are the same project.
- **Thresholds are judgements.** The completeness floor, the high-confidence minimum and
  the noise ceiling are first guesses calibrated on the fixtures, exposed as flags
  precisely because they are not facts.
- **`HIGH_CONFIDENCE` is currently two rules.** That is narrow on purpose — it is what
  makes `READY_FOR_REVIEW` mean something — but it also means a repository whose only
  problems are typographic can never be proposed, only held for a human.
- **A workspace is one directory deep.** Nested checkouts, monorepos with several
  products, and a repository that is itself the workspace root all need `--single` or a
  different layout.
