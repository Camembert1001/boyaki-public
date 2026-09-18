# YN0 Distribution Scanner (internal MVP)

Internal tooling for the Japanese UI Mechanical Preflight experiment. It reduces manual
prospect discovery by scanning a **local** checkout for EN/JA locale pairs, running the
same mechanical checks the public [JP UI Preflight](../../yn0-jp-ui-preflight/) runs, and
classifying each pair by how workable the findings look.

**This is not a product feature.** It does no outreach, sends no email, opens no issues or
comments, drives no browser, handles no credentials, and makes no network call. It is
read-only: it reports, and never rewrites a locale file.

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

JSON only (CSV is deliberately out of scope for the MVP). A file is treated as a locale
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
- **Orrery could not be identified.** No repository named Orrery with an EN/JA locale pair
  was locatable from the issue's description alone, so its 3,114-key / 0-finding shape was
  not reproduced against a live checkout. It is the same shape as CritterDex, which was
  reproduced, and both are pinned in the benchmark test.

The observed shapes are pinned as a test (`observed benchmark shapes land in their
documented buckets`) so a future threshold change has to restate its effect on them.

## Tests

```
node --test internal/distribution-scanner/tests/scanner.test.mjs
```

No dependencies, no install step, no network. Node 22 built-ins only.

## Known limitations

- JSON only. CSV, `.po`, `.strings`, `.resx`, YAML and XLIFF are not read.
- Only the seven rules above run. The public Preflight's kinsoku, display-width,
  control-character, line-break-count and punctuation-mixing checks are not ported —
  they were outside this MVP's scope.
- Thresholds are a first guess, calibrated against the repositories in **Benchmark
  validation** above. Retune them before treating a bucket as a decision.
- `advisoryRules` is a fixed list, not a CLI option. Widening it is a judgement about which
  rules are house style rather than defects, and belongs in review, not in a flag.
- Orrery, one of the five issue #9 benchmarks, was never identified and so was validated
  only as a pinned shape, not against a live checkout.
- Locale discovery is name-based. A project that stores Japanese in a file with no `ja`
  tag in its path is invisible to the scanner.
- One EN and one JA file per group are scanned; alternates are reported, not compared.
- `null` locale values flatten to an empty string, so a `null` JA value reads as
  `empty-ja`.
