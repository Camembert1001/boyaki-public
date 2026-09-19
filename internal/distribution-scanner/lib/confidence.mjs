// Finding confidence for the YN0 Prospect Discovery layer.
//
// The seven mechanical checks in checks.mjs are unchanged and stay unchanged: the same
// rules, the same severities, the same ADVISORY_RULES split. This module adds one
// question on top of them, and only for prospect discovery:
//
//   "Would I be comfortable putting this finding in front of a stranger as the reason
//    I am writing to them?"
//
// That is a different question from "is this a defect?", and Atlos is why it is asked
// separately: a checker whose findings a maintainer can wave away as intentional cannot
// be a CI or release gate, and a finding a maintainer can wave away is not a reason to
// spend one of a finite number of first contacts.
//
// Three bands:
//
//   HIGH_CONFIDENCE    a mechanical defect that survives "could this be on purpose?".
//                      A user sees the consequence; no house style explains it away.
//   INTENTIONAL_RISK   a real observation that a project may well have written on
//                      purpose - padding, typography, a deliberately repeated
//                      placeholder. Reported, never counted as a reason to contact.
//   INCOMPLETE_LOCALE  "this locale is not finished yet". True, uninteresting, and
//                      not something to write to a maintainer about.
//
// Severity and confidence are orthogonal and stay that way. `halfwidth-katakana` is a
// WARN and is HIGH_CONFIDENCE, because half-width katakana in a UI string is a legacy
// encoding artifact rather than a style; `fullwidth-space` is the same severity and is
// INTENTIONAL_RISK, because U+3000 is ordinary Japanese typography.
import {RULES} from './checks.mjs';

export const CONFIDENCE_BANDS = ['HIGH_CONFIDENCE', 'INTENTIONAL_RISK', 'INCOMPLETE_LOCALE'];

export const RULE_CONFIDENCE = {
 // A placeholder the English string has and the Japanese string does not: the user is
 // shown a literal `{name}`, or the argument silently disappears. Nobody writes that on
 // purpose, which is what makes it the one finding worth a first contact on its own.
 'placeholder-set-mismatch': 'HIGH_CONFIDENCE',
 // Half-width katakana in a Japanese UI string is a legacy encoding artifact.
 'halfwidth-katakana': 'HIGH_CONFIDENCE',
 // Already advisory in the checker: PocketRoles pads 47 of 1,069 strings deliberately.
 'edge-whitespace': 'INTENTIONAL_RISK',
 // U+3000 is how Japanese text is spaced. Reported, not a defect claim to a stranger.
 'fullwidth-space': 'INTENTIONAL_RISK',
 // The checker's own comment says natural Japanese may legitimately repeat a placeholder.
 'placeholder-multiplicity-mismatch': 'INTENTIONAL_RISK',
 'missing-ja': 'INCOMPLETE_LOCALE',
 'empty-ja': 'INCOMPLETE_LOCALE'
};

// An unbanded rule is never evidence for contacting anyone. A new check therefore
// cannot raise a prospect to READY_FOR_REVIEW by accident - it has to be banded on
// purpose, and a test fails until it is.
export const bandOf = rule => RULE_CONFIDENCE[rule] ?? 'INTENTIONAL_RISK';

export const UNBANDED_RULES = Object.keys(RULES).filter(rule => !(rule in RULE_CONFIDENCE)).sort();

// Fold a `{rule: count}` map into `{band: count}`, every band present.
export function bandCounts(findingsByRule) {
 const counts = Object.fromEntries(CONFIDENCE_BANDS.map(band => [band, 0]));
 for (const [rule, count] of Object.entries(findingsByRule ?? {})) counts[bandOf(rule)] += count;
 return counts;
}

export const isHighConfidence = finding => bandOf(finding.rule) === 'HIGH_CONFIDENCE';

// How much of what we would actually cite is stuff a maintainer could wave away.
//
// Incomplete-locale findings are excluded on purpose: "this locale is 40% translated"
// is governed by locale completeness, not by noise, and folding it in here would let a
// half-finished locale bury two genuine placeholder bugs.
//
//   0.0  every citable finding is high-confidence
//   1.0  nothing citable is high-confidence
export function noiseRatio(counts) {
 const citable = counts.HIGH_CONFIDENCE + counts.INTENTIONAL_RISK;
 return citable === 0 ? 0 : 1 - counts.HIGH_CONFIDENCE / citable;
}
