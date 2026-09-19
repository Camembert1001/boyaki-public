// The vocabulary of public evidence a candidate may be described with.
//
// This is a closed list on purpose. The validation-value layer above it is only as
// honest as its inputs, and the failure mode it exists to prevent is a machine quietly
// inventing a reason to put a stranger in front of a human. So:
//
//   * an unknown signal id is an error, not an unrecognised extra;
//   * every signal instance must cite a public source and say what it saw there;
//   * nothing here describes a *person*. Every signal is about published work or a
//     published workflow - what a repository contains, what a page offers, what a commit
//     touched. None of them is about who somebody is or what they can afford.
//
// FORBIDDEN_INFERENCES below is the other half of that rule, and it is enforced by test:
// purchasing authority, budget, willingness to pay, reply probability and the rest are
// never signals, never derived, and always reported as unknown. A candidate with perfect
// evidence on every axis still does not have a "will buy" field, because nothing public
// is evidence for one.
import {VALIDATION_AXES} from '../../contact-state/lib/model.mjs';

// STRONG: on its own the observation is specific enough that a second one makes a case.
// MODERATE: real, but consistent with several stories; it needs company.
export const STRENGTHS = ['STRONG', 'MODERATE'];

// Where a signal came from. `repository` is the only one a machine may assert by itself
// (it read the files); everything else is a human quoting a public page.
export const SIGNAL_ORIGINS = ['repository', 'public_page', 'public_profile', 'public_thread'];

// `machineDerivable` defaults to "the observation is in the repository, so a machine that
// read the repository may assert it". It is overridable because that inference fails for
// an observation about an *absence*: a machine can see that a file exists, never that
// nobody is responsible for one.
const signal = (supports, weakens, strength, origin, description, machineDerivable = origin === 'repository') =>
 ({supports, weakens, strength, origin, machineDerivable, description});

// The whole vocabulary. `supports` / `weakens` name the axes an observation bears on;
// an axis that appears in neither is untouched by that signal.
export const SIGNALS = {
 // --- payer-relevant: published commercial activity, never a guess about a person ---
 PAID_LOCALIZATION_OFFERED: signal(['payer'], [], 'STRONG', 'public_page',
  'a public page offers localization work for money (rate card, services page, commission listing)'),
 COMMERCIAL_RELEASE: signal(['payer'], [], 'MODERATE', 'public_page',
  'a shipped, sold product is publicly linked from the project (store page, paid release)'),
 FREELANCE_OR_STUDIO: signal(['payer'], [], 'MODERATE', 'public_profile',
  'the party publicly presents as a freelance localizer or a studio, not as a hobby project'),
 MULTIPLE_SHIPPED_PROJECTS: signal(['payer'], [], 'MODERATE', 'public_profile',
  'several shipped, localized projects are publicly attributed to the same party'),

 // --- workflow-relevant: what the published process actually does ---
 HANDS_ON_LQA: signal(['payer', 'workflow'], [], 'MODERATE', 'public_thread',
  'the party publicly does localization QA itself - filing, triaging or fixing locale bugs'),
 HANDLES_LOCALIZATION_FILES: signal(['workflow'], [], 'MODERATE', 'repository',
  'localization files are edited in this repository rather than round-tripped through a vendor'),
 TOOLING_CHOICE_EVIDENCE: signal(['workflow'], [], 'STRONG', 'public_page',
  'a public document states which localization tooling the project uses and why'),
 CI_LOCALIZATION_STEP: signal(['workflow'], [], 'STRONG', 'repository',
  'a checked-in CI workflow runs a localization or translation step'),

 // --- problem / usefulness ---
 LOCALIZATION_REGRESSION_HISTORY: signal(['problem'], [], 'STRONG', 'public_thread',
  'a public issue or changelog records a shipped locale defect of the kind the checker finds'),
 TRANSLATOR_FACING_DOCS: signal(['usefulness'], [], 'MODERATE', 'public_page',
  'public instructions exist for contributors translating this project'),

 // --- evidence that argues the other way. Recorded, because the absence of a reason to
 //     proceed is itself worth reporting, and because a value layer that can only be
 //     talked up is not a filter.
 NONCOMMERCIAL_ONLY: signal([], ['payer'], 'MODERATE', 'public_page',
  'the project publicly states it is non-commercial, unpaid or donation-free'),
 VOLUNTEER_TRANSLATION_ONLY: signal([], ['payer'], 'MODERATE', 'public_page',
  'translation is publicly described as volunteer or community work'),
 NO_LOCALIZATION_OWNER: signal([], ['payer', 'workflow'], 'MODERATE', 'repository',
  'no party in this repository is visibly responsible for localization', false)
};

export const SIGNAL_IDS = Object.keys(SIGNALS).sort();

// Signals a machine may assert from the repository it just read. Everything else needs a
// human to have looked at a public page and quoted it, which is the boundary that keeps
// the payer axis from being answered by a heuristic.
export const MACHINE_DERIVABLE = SIGNAL_IDS.filter(id => SIGNALS[id].machineDerivable);

// Things that are never inferred, never stored, and always reported as unknown.
//
// Each of these is either a fact about a person's circumstances or a prediction about
// their future behaviour. Public work evidence is not evidence for any of them, and a
// discovery engine that pretended otherwise would be guessing about strangers.
export const FORBIDDEN_INFERENCES = [
 'purchasing authority',
 'budget',
 'income',
 'willingness to pay',
 'reply probability',
 'company size',
 'personality',
 'technical ability',
 'current tool stack',
 'whether they would buy YN0'
];

export class SignalError extends Error {}

const fail = message => {
 throw new SignalError(message);
};

const assertText = (value, label) => {
 if (typeof value !== 'string' || value.trim() === '') fail(label + ' must be a non-empty string');
 return value;
};

// One cited observation. The shape deliberately mirrors contact-state's evidence record:
// a source, a locator and what was actually seen there - never our reading of it.
export function normalizeSignal(raw, label) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must be an object');
 const id = raw.signal;
 if (!SIGNAL_IDS.includes(id)) {
  fail(label + '.signal must be one of ' + SIGNAL_IDS.join(', ') + ' (got ' + JSON.stringify(id) + ')');
 }
 // No citation, no signal. This is the whole discipline of the layer: a value the report
 // cannot show a source for is a value nobody can check.
 return {
  signal: id,
  source: assertText(raw.source, label + '.source'),
  observed: assertText(raw.observed ?? raw.quote_or_summary, label + '.observed')
 };
}

export function normalizeSignals(raw, label) {
 if (raw === undefined) return [];
 if (!Array.isArray(raw)) fail(label + ' must be an array of signals');
 const signals = raw.map((item, index) => normalizeSignal(item, label + '[' + index + ']'));
 // Sorted and de-duplicated by (signal, source): the same observation cited twice is one
 // observation, and counting it twice would be the cheapest way to fake a HIGH.
 const seen = new Set();
 return signals
  .sort((a, b) => (a.signal < b.signal ? -1 : a.signal > b.signal ? 1 : a.source < b.source ? -1 : 1))
  .filter(item => {
   const key = item.signal + '\u0000' + item.source;
   if (seen.has(key)) return false;
   seen.add(key);
   return true;
  });
}

// Which signals bear on one axis, split by direction. Unknown axes cannot be asked about.
export function forAxis(signals, axis) {
 if (!VALIDATION_AXES.includes(axis)) fail('unknown validation axis: ' + axis);
 const supporting = signals.filter(item => SIGNALS[item.signal].supports.includes(axis));
 const weakening = signals.filter(item => SIGNALS[item.signal].weakens.includes(axis));
 return {supporting, weakening};
}
