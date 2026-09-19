// Orchestration for the YN0 Prospect Discovery v3 review pass.
//
//   validation hypothesis            (hypothesis.mjs - derived from contact-state)
//     -> candidate manifest          (manifest.mjs - written by discovery/, read here)
//     -> v2 prospect discovery       (prospects.mjs, unchanged)
//         -> localization assets, mechanical scan, finding confidence,
//            repository evidence, contact-state posture, v2 verdict
//     -> validation value            (value.mjs + signals.mjs)
//     -> identity / de-duplication   (identity.mjs)
//     -> candidate queue             (queue.mjs)
//     -> exploration yield           (yield.mjs)
//     -> HUMAN REVIEW
//
// The last line is the end of the program. Nothing here or downstream sends mail, opens
// an issue, writes a comment, fills a form, drives a browser, holds a credential or makes
// a network call - and a test asserts the absence rather than trusting the comment.
//
// Offline and deterministic: the same workspace, manifest, hypothesis and contact-state
// snapshot produce byte-identical output, forever. The exploration that produced the
// manifest is allowed to be time-dependent; everything from the manifest onwards is not.
import {VALIDATION_AXES} from '../../contact-state/lib/model.mjs';
import {discover} from './prospects.mjs';
import {outstandingAxes} from './contact-link.mjs';
import {toMetadata} from './manifest.mjs';
import {defaultHypothesis, focusOf, fromContactStore, withOutstanding} from './hypothesis.mjs';
import {evaluateValue} from './value.mjs';
import {resolveIdentities} from './identity.mjs';
import {LANES, compareByLane, compareCandidates, decideLane} from './queue.mjs';
import {overallYield, yieldByStrategy} from './yield.mjs';

export const SCHEMA = 'yn0-prospect-review-v3';

const emptyCandidate = id => ({
 id,
 strategy_ids: [],
 owner: null,
 repository: null,
 url: null,
 path: id,
 signals: [],
 discovery: null,
 aliases: []
});

// Which candidates are definitely the same party, and which one of them a human should
// read first. Only a declared owner creates a duplicate - a shared token never does, and
// lands in the AMBIGUOUS lane instead, where a person decides.
function markDuplicates(entries, identities) {
 const byId = new Map(entries.map(entry => [entry.id, entry]));
 const duplicates = new Map();
 for (const identity of identities) {
  if (identity.state !== 'MATCH' || identity.group.length < 2) continue;
  const members = identity.group.map(id => byId.get(id)).filter(Boolean).sort(compareCandidates);
  for (const member of members.slice(1)) duplicates.set(member.id, members[0].id);
 }
 return duplicates;
}

export async function review(workspacePath, options = {}) {
 const manifest = options.manifest ?? null;
 const contacts = options.contacts ?? null;

 // The hypothesis, in the order the inputs deserve: an explicit file if one was given,
 // otherwise derived from the contact store, otherwise the least presumptuous default -
 // and either way, only the store may say an answer is outstanding on the wire.
 const outstanding = contacts ? outstandingAxes(contacts) : [];
 const base = options.hypothesis ?? (contacts ? fromContactStore(contacts) : defaultHypothesis());
 const hypothesis = withOutstanding(base, outstanding);
 const focus = focusOf(hypothesis, options.asking ?? null);

 // v2 runs exactly as it does on its own, with the manifest handed to it in the shape it
 // already takes. Its verdicts are inputs here, never overridden.
 const v2 = await discover(workspacePath, {
  single: options.single ?? false,
  contacts,
  metadata: manifest ? toMetadata(manifest) : (options.metadata ?? null),
  asking: focus,
  thresholds: options.thresholds,
  scanThresholds: options.scanThresholds,
  samples: options.samples
 });

 const entries = v2.prospects.map(prospect => {
  const candidate = manifest?.candidates.get(prospect.id) ?? emptyCandidate(prospect.id);
  return {
   id: prospect.id,
   candidate,
   prospect,
   value: evaluateValue(candidate.signals, hypothesis, focus)
  };
 });

 const identities = resolveIdentities(entries.map(entry => ({
  id: entry.id,
  owner: entry.candidate.owner,
  aliases: entry.candidate.aliases ?? []
 })));
 const identityById = new Map(identities.map(identity => [identity.id, identity]));
 const duplicates = markDuplicates(entries, identities);

 for (const entry of entries) {
  entry.identity = identityById.get(entry.id);
  entry.duplicateOf = duplicates.get(entry.id) ?? null;
  entry.queue = decideLane({
   prospect: entry.prospect,
   value: entry.value,
   identity: entry.identity,
   focus,
   outstandingAxes: hypothesis.outstandingAxes,
   duplicateOf: entry.duplicateOf
  });
 }

 const ordered = [...entries].sort(compareByLane);
 const summary = Object.fromEntries(LANES.map(lane => [lane, ordered.filter(entry => entry.queue.name === lane).length]));

 return {
  schema: SCHEMA,
  root: v2.root,
  mode: v2.mode,
  hypothesis: {
   source: hypothesis.source,
   axes: hypothesis.axes,
   priority: hypothesis.priority,
   openAxes: hypothesis.openAxes,
   outstandingAxes: hypothesis.outstandingAxes,
   focusAxis: focus,
   focusRequested: options.asking ?? null
  },
  contactStore: v2.contactStore,
  manifest: manifest
   ? {provided: true, asOf: manifest.as_of, budget: manifest.budget, strategyCount: manifest.strategies.length,
      candidateCount: manifest.candidates.size}
   : {provided: false, asOf: null, budget: null, strategyCount: 0, candidateCount: 0},
  thresholds: v2.thresholds,
  candidateCount: ordered.length,
  summary,
  v2Summary: v2.summary,
  yield: {
   overall: overallYield(entries, manifest),
   byStrategy: yieldByStrategy(entries, manifest)
  },
  candidates: ordered.map(entry => ({
   id: entry.id,
   lane: entry.queue.name,
   laneRule: entry.queue.lane,
   laneReason: entry.queue.reason,
   release: entry.queue.release,
   repository: entry.candidate.repository,
   url: entry.candidate.url,
   strategyIds: entry.candidate.strategy_ids,
   identity: entry.identity,
   duplicateOf: entry.duplicateOf,
   validationValue: entry.value,
   v2: {
    verdict: entry.prospect.verdict,
    rule: entry.prospect.rule,
    reason: entry.prospect.reason,
    contactPosture: entry.prospect.contact.posture,
    assets: entry.prospect.assets,
    evidence: entry.prospect.evidence,
    samples: entry.prospect.samples,
    metadata: entry.prospect.metadata,
    notes: entry.prospect.notes,
    skipped: entry.prospect.skipped
   }
  }))
 };
}

const rate = entry => (entry.rate === null ? 'n/a' : (entry.rate * 100).toFixed(1) + '%');

const funnelLine = (label, conversions) => '  ' + label.padEnd(24) + Object.entries(conversions)
 .map(([name, value]) => name + ' ' + value.numerator + '/' + value.denominator + ' ' + rate(value) +
  (value.sample === 'SMALL' ? '*' : ''))
 .join('  ');

const laneLine = lanes => '    lanes: ' + (Object.keys(lanes).length
 ? LANES.filter(lane => lanes[lane]).map(lane => lane + ' ' + lanes[lane]).join(' - ')
 : 'none');

export function renderText(report) {
 const lines = [];
 lines.push('YN0 Prospect Discovery v3 - ' + report.root + ' (' + report.mode + ')');
 lines.push(report.candidateCount + ' candidate' + (report.candidateCount === 1 ? '' : 's') + ' - ' +
  LANES.map(lane => lane + ' ' + report.summary[lane]).join(' - '));

 const h = report.hypothesis;
 lines.push('hypothesis (' + h.source + '): ' +
  VALIDATION_AXES.map(axis => axis + '=' + h.axes[axis].state + (h.axes[axis].outstanding ? '(outstanding)' : '')).join(' '));
 lines.push('asking about: ' + (h.focusAxis ?? 'nothing - every axis is already evidenced') +
  (h.focusRequested ? ' (requested)' : ' (highest-priority open axis)'));
 lines.push('contact store: ' + (report.contactStore.provided
  ? report.contactStore.contactCount + ' contact(s), outstanding axes: ' + (report.contactStore.outstandingAxes.join(', ') || 'none')
  : 'not provided - no candidate can be shown as never contacted'));
 lines.push('manifest: ' + (report.manifest.provided
  ? report.manifest.candidateCount + ' candidate(s) from ' + report.manifest.strategyCount + ' strategy/strategies' +
    (report.manifest.asOf ? ', as of ' + report.manifest.asOf : '')
  : 'not provided - no strategy attribution, no public evidence, no exploration yield'));

 lines.push('');
 lines.push('Exploration yield (* = fewer than 20 samples; the funnel is a prefix, so a');
 lines.push('candidate that misses a stage is not counted past it - see "lanes" for what a');
 lines.push('person actually has to read):');
 lines.push(funnelLine('overall', report.yield.overall.conversions));
 for (const row of report.yield.byStrategy) {
  lines.push(funnelLine(row.strategy_id, row.conversions) + (row.truncated ? '  [truncated: ' + row.truncated_reason + ']' : ''));
  lines.push(laneLine(row.lanes));
 }

 for (const lane of LANES) {
  const inLane = report.candidates.filter(candidate => candidate.lane === lane);
  if (!inLane.length) continue;
  lines.push('');
  lines.push('== ' + lane + ' (' + inLane.length + ') ==');
  for (const candidate of inLane) {
   const value = candidate.validationValue;
   lines.push('');
   lines.push('[' + lane + '] ' + candidate.id + (candidate.repository ? '  (' + candidate.repository + ')' : '') +
    '  (queue rule ' + candidate.laneRule + ', v2 ' + candidate.v2.verdict + ' rule ' + candidate.v2.rule + ')');
   lines.push('  why: ' + candidate.laneReason);
   if (candidate.release) lines.push('  releases when: ' + candidate.release);
   lines.push('  validation value: ' + value.value + ' on ' + (value.focusAxis ?? 'no open axis') +
    (value.rule ? ' (value rule ' + value.rule + ')' : ''));
   for (const item of value.focusAxis ? value.axes[value.focusAxis].evidence : []) lines.push('    evidence: ' + item);
   for (const item of value.focusAxis ? value.axes[value.focusAxis].weakening : []) lines.push('    against:  ' + item);
   lines.push('    unknown:  ' + value.unknown.join(', ') + ' - not inferred, not stored');
   lines.push('  contact: ' + candidate.v2.contactPosture + ' - activity ' + candidate.v2.metadata.activity +
    ' - route ' + candidate.v2.metadata.public_contact_route);
   lines.push('  identity: ' + candidate.identity.state + ' - ' + candidate.identity.reason);
   if (candidate.strategyIds.length) lines.push('  found by: ' + candidate.strategyIds.join(', '));
   const e = candidate.v2.evidence;
   lines.push('  evidence: ' + e.pairCount + ' pair(s) - findings ' + e.totalFindings +
    ' (high ' + e.highConfidenceFindings + ', intentional-risk ' + e.intentionalRiskFindings + ')');
   for (const sample of candidate.v2.samples.slice(0, 3)) {
    lines.push('  - ' + sample.severity.padEnd(5) + ' ' + sample.rule + ' [' + sample.key + '] ' + sample.detail);
   }
  }
 }

 if (!report.candidateCount) lines.push('', 'No candidate repositories found under this path.');
 lines.push('');
 lines.push('This report is a reading list. It decides nothing about who is contacted, and nothing here contacts anyone.');
 return lines.join('\n');
}
