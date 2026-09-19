// Tests for the YN0 Prospect Discovery v3 layers. Run with:
//   node --test internal/distribution-scanner/tests/discovery.test.mjs
//
// Everything here is synthetic. The fixtures under ../prospect-fixtures/v3-* are invented,
// every candidate directory is named after the *shape* it exercises, every contact id ends
// in `-shape`, and no test in this file makes a network call: the explorer is driven by a
// fake client defined below.
//
// The safety properties this suite exists for are the ones that are cheaper to keep by
// test than by intention - that exploration cannot reach the scanner core, that nothing
// here can reach a person, that an unknown stays unknown, and that a candidate nobody has
// checked against the contact store can never be proposed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {VALIDATION_AXES} from '../../contact-state/lib/model.mjs';
import {readContactStore} from '../lib/contact-link.mjs';
import {AXIS_STATES, HypothesisError, defaultHypothesis, focusOf, fromContactStore, loadHypothesis, withOutstanding} from '../lib/hypothesis.mjs';
import {FORBIDDEN_INFERENCES, MACHINE_DERIVABLE, SIGNALS, SIGNAL_IDS, SIGNAL_ORIGINS, STRENGTHS, SignalError, normalizeSignals} from '../lib/signals.mjs';
import {VALUES, evaluateValue, valueForAxis} from '../lib/value.mjs';
import {resolveIdentities} from '../lib/identity.mjs';
import {LANES, decideLane} from '../lib/queue.mjs';
import {CONVERSIONS, SMALL_SAMPLE, STAGES, conversion, stagesReached} from '../lib/yield.mjs';
import {ManifestError, loadManifest, mergeManifests, normalizeManifest, serializeManifest, toMetadata} from '../lib/manifest.mjs';
import {SCHEMA, renderText, review} from '../lib/review.mjs';
import {parseArgs} from '../review.mjs';

import {Budget, DEFAULT_BUDGET, LIMITS as LIMIT_KEYS, PER_STRATEGY_LIMITS} from '../discovery/lib/budget.mjs';
import {SORTS, StrategyError, loadStrategies, normalizeStrategy} from '../discovery/lib/strategies.mjs';
import {createClient} from '../discovery/lib/github.mjs';
import {activityOf, candidateId, contactRouteOf, explore, machineSignals} from '../discovery/lib/explore.mjs';
import {parseArgs as parseExploreArgs} from '../discovery/explore.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scannerDir = path.join(here, '..');
const fixtures = path.join(scannerDir, 'prospect-fixtures');
const workspace = path.join(fixtures, 'v3-workspace');

const load = async name => readFile(path.join(fixtures, name), 'utf8');

const inputs = async (store = 'v3-contacts.json') => ({
 contacts: readContactStore(await load(store), 'fixture store'),
 manifest: loadManifest(await load('v3-manifest.json'), 'fixture manifest')
});

const run = async (extra = {}, store) => review(workspace, {...(await inputs(store)), ...extra});
const byId = report => Object.fromEntries(report.candidates.map(candidate => [candidate.id, candidate]));

// A cited observation, in the shape the signal vocabulary requires.
const cite = signal => ({signal, source: 'https://example.invalid/' + signal.toLowerCase(), observed: 'invented shape'});

// ---------------------------------------------------------------------------------------
// The queue, pinned end to end.
// ---------------------------------------------------------------------------------------

test('every v3 fixture lands on its documented lane and queue rule', async () => {
 const report = await run();
 const candidates = byId(report);
 const expected = {
  'paid-studio-alpha':         ['READY_FOR_REVIEW', 11],
  'kagerou-north-port':        ['HUMAN_REVIEW', 5],
  'kagerou-south-port':        ['HUMAN_REVIEW', 5],
  'unchecked-contact-repo':    ['HUMAN_REVIEW', 2],
  'unevidenced-candidate':     ['HUMAN_REVIEW', 9],
  'unsupported-po-repo':       ['HUMAN_REVIEW', 4],
  'noisy-locale-repo':         ['HUMAN_REVIEW', 4],
  'paid-studio-alpha-tools':   ['RESERVE', 7],
  'volunteer-fan-translation': ['RESERVE', 10],
  'opted-out-repo':            ['IGNORE', 1]
 };
 assert.deepEqual(Object.keys(candidates).sort(), Object.keys(expected).sort());
 for (const [id, [lane, rule]] of Object.entries(expected)) {
  assert.deepEqual([candidates[id].lane, candidates[id].laneRule], [lane, rule], id);
  assert.ok(candidates[id].laneReason.length > 0, id + ' must say why');
 }
 // The shape of the whole exercise: ten candidates in, one proposed.
 assert.deepEqual(report.summary, {READY_FOR_REVIEW: 1, HUMAN_REVIEW: 6, RESERVE: 2, IGNORE: 1});
 assert.equal(report.schema, SCHEMA);
});

// 1. Exploration may not creep into the checker.
test('the scanner core holds no network or exploration dependency', async () => {
 const sources = [];
 const collect = async dir => {
  for (const item of (await readdir(dir, {withFileTypes: true})).sort((a, b) => (a.name < b.name ? -1 : 1))) {
   const next = path.join(dir, item.name);
   if (item.isDirectory()) await collect(next);
   else if (item.name.endsWith('.mjs')) sources.push([next, await readFile(next, 'utf8')]);
  }
 };
 await collect(path.join(scannerDir, 'lib'));
 for (const name of ['scan.mjs', 'prospect.mjs', 'review.mjs']) {
  sources.push([name, await readFile(path.join(scannerDir, name), 'utf8')]);
 }
 assert.ok(sources.length >= 14, 'the scan found the modules it meant to check');

 const forbidden = ['node:http', 'node:https', 'node:net', 'node:dns', 'node:child_process', 'fetch(',
  'XMLHttpRequest', 'nodemailer', 'sendmail', 'smtp', 'octokit', 'api.github.com', 'githubusercontent'];
 for (const [name, text] of sources) {
  for (const marker of forbidden) {
   assert.equal(text.toLowerCase().includes(marker.toLowerCase()), false, name + ' must not reference ' + marker);
  }
  // The offline half must not import the network half either, in any direction.
  assert.equal(/from ['"][^'"]*discovery\//.test(text), false, name + ' must not import from discovery/');
 }
});

// 15. And the exploration half, which *is* allowed a network, must have no way to send.
test('the discovery layer has no outreach surface and holds no credential', async () => {
 const sources = [];
 const collect = async dir => {
  for (const item of (await readdir(dir, {withFileTypes: true})).sort((a, b) => (a.name < b.name ? -1 : 1))) {
   const next = path.join(dir, item.name);
   if (item.isDirectory()) await collect(next);
   else if (item.name.endsWith('.mjs')) sources.push([next, await readFile(next, 'utf8')]);
  }
 };
 await collect(path.join(scannerDir, 'discovery'));
 assert.ok(sources.length >= 5, 'the scan found the discovery modules');

 const forbidden = ['nodemailer', 'sendmail', 'smtp', 'mailto:', 'sendMail', 'createIssue', 'createComment',
  'issues/comments', 'pulls/comments', 'node:child_process'];
 for (const [name, text] of sources) {
  for (const marker of forbidden) {
   assert.equal(text.toLowerCase().includes(marker.toLowerCase()), false, name + ' must not reference ' + marker);
  }
  // A literal token in source is the failure this rules out by shape: the only way a
  // credential enters is from the environment, in github.mjs, at call time.
  assert.equal(/gh[pousr]_[A-Za-z0-9]{16,}/.test(text), false, name + ' must not carry a literal token');
 }
 const client = await readFile(path.join(scannerDir, 'discovery', 'lib', 'github.mjs'), 'utf8');
 for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
  assert.equal(client.includes("'" + method + "'") && !client.includes('is not available'), false,
   'github.mjs must not offer ' + method);
 }
});

// The refusal is a real code path, not a comment about one.
test('the GitHub client refuses every method but GET', async () => {
 let attempted = null;
 const transport = async (url, init) => {
  attempted = init.method;
  return {ok: true, status: 200, headers: {get: () => null}, json: async () => ({items: []}), text: async () => ''};
 };
 const client = createClient({transport, env: {}});
 await client.searchRepositories('anything');
 assert.equal(attempted, 'GET', 'the only method the client ever issues is GET');
 // And the surface itself offers nothing else: no create, no comment, no send.
 assert.deepEqual(Object.keys(client).sort(), ['getFile', 'listTree', 'searchRepositories']);
});

// ---------------------------------------------------------------------------------------
// Prospect Burn: what may never reach the front of the queue.
// ---------------------------------------------------------------------------------------

// 4. Nobody is proposed on the strength of a contact check that never happened.
test('a candidate whose contact history was never checked can never be proposed', async () => {
 const report = await run();
 const candidate = byId(report)['unchecked-contact-repo'];
 assert.equal(candidate.v2.contactPosture, 'UNCHECKED');
 assert.notEqual(candidate.lane, 'READY_FOR_REVIEW');
 assert.equal(candidate.laneRule, 2);
 // Even with the strongest possible public evidence on the axis being asked about.
 assert.equal(candidate.validationValue.value, 'HIGH');

 // And with no contact store at all, nothing can be proposed - "we never wrote to them" is
 // a claim about a store, and not having looked at one is not that claim.
 const blind = await review(workspace, {manifest: (await inputs()).manifest});
 assert.equal(blind.summary.READY_FOR_REVIEW, 0);
 for (const entry of blind.candidates) assert.notEqual(entry.lane, 'READY_FOR_REVIEW');
});

// 5. An opted-out contact is not merely down-ranked; it is at the bottom, by rule.
test('DO_NOT_CONTACT can never be a top candidate', async () => {
 const report = await run();
 const candidate = byId(report)['opted-out-repo'];
 assert.equal(candidate.lane, 'IGNORE');
 assert.equal(candidate.laneRule, 1);
 assert.equal(candidate.v2.rule, 1);
 // Last in the report, behind every lane a person reads.
 assert.equal(report.candidates[report.candidates.length - 1].id, 'opted-out-repo');

 // The lane table itself, against the strongest evidence a candidate could carry.
 const strongest = {
  prospect: {verdict: 'IGNORE', rule: 1, reason: 'contact-state: contact opted out',
   contact: {posture: 'DO_NOT_CONTACT', reason: 'contact opted out'}, evidence: {highConfidenceFindings: 99}},
  value: {value: 'HIGH', rule: 6, reason: 'irrelevant'},
  identity: {state: 'MATCH', reason: 'unique'},
  focus: 'payer',
  outstandingAxes: [],
  duplicateOf: null
 };
 assert.equal(decideLane(strongest).name, 'IGNORE');
});

// 6 and 7. While one contact owes us the payer answer, no second stranger is queued for
// the same question - and the candidates are kept rather than thrown away.
test('an outstanding answer on an axis holds new candidates without discarding them', async () => {
 const held = await run({}, 'v3-contacts-payer-open.json');
 assert.deepEqual(held.hypothesis.outstandingAxes, ['payer']);
 assert.equal(held.hypothesis.focusAxis, 'payer');
 assert.equal(held.summary.READY_FOR_REVIEW, 0, 'no second payer question is queued');

 // Every candidate that would otherwise be proposed is in RESERVE, with its evidence and
 // the condition that would release it.
 const reserved = held.candidates.filter(candidate => candidate.lane === 'RESERVE');
 assert.equal(reserved.length, 6);
 for (const candidate of reserved) {
  assert.ok(candidate.release, candidate.id + ' must say what would release it');
 }
 const alpha = byId(held)['paid-studio-alpha'];
 assert.equal(alpha.lane, 'RESERVE');
 assert.equal(alpha.laneRule, 3);
 assert.match(alpha.release, /payer/);
 // Held, not degraded: the evidence that made it a candidate is still there.
 assert.equal(alpha.validationValue.value, 'HIGH');
 assert.ok(alpha.validationValue.axes.payer.evidence.length >= 2);

 // Exploration is not what stops: the same candidates are still discovered and evaluated.
 assert.equal(held.candidateCount, 10);
 assert.equal(held.v2Summary.IGNORE + held.v2Summary.HUMAN_REVIEW + held.v2Summary.READY_FOR_REVIEW, 10);

 // Asking a different question releases them, because it is a different question.
 const other = await run({asking: 'workflow'}, 'v3-contacts-payer-open.json');
 assert.equal(other.hypothesis.focusAxis, 'workflow');
 assert.ok(other.summary.READY_FOR_REVIEW + other.summary.RESERVE > 0);
 assert.equal(other.candidates.some(candidate => candidate.laneRule === 3), false);
});

// 16. Nothing from the contact store crosses into the report.
test('no contact record leaks into the v3 report', async () => {
 const store = readContactStore(await load('v3-contacts-payer-open.json'), 'fixture store');
 for (const {contact} of store.contacts) {
  assert.match(contact.id, /-shape$/, 'a fixture contact id names a conversation shape, never a party');
  assert.match(contact.name, /^Prospect [A-Z]$/, contact.id);
  assert.match(contact.organization, /^Example /, contact.id);
  assert.equal(contact.channel_ref, null, contact.id + ' must not carry a thread reference');
 }
 const report = JSON.stringify(await run({}, 'v3-contacts-payer-open.json'));
 for (const {contact} of store.contacts) {
  assert.equal(report.includes(contact.name), false, contact.name + ' leaked into the report');
  assert.equal(report.includes(contact.organization), false, contact.organization + ' leaked into the report');
  for (const axis of VALIDATION_AXES) {
   for (const item of contact.validation[axis].evidence) {
    assert.equal(report.includes(item.quote_or_summary), false, 'an evidence quote leaked into the report');
   }
  }
 }
 assert.equal(/@[a-z0-9-]+\.[a-z]{2,}/i.test(report), false, 'the report holds nothing that looks like an address');
 const rendered = renderText(await run({}, 'v3-contacts-payer-open.json'));
 for (const {contact} of store.contacts) {
  assert.equal(rendered.includes(contact.name), false, 'the rendered report holds no contact name');
  assert.equal(rendered.includes(contact.organization), false, 'the rendered report holds no organization');
 }
});

// 14. And no real contact information is in any tracked fixture, in any form.
test('tracked fixtures carry no real contact data', async () => {
 const tracked = [];
 const collect = async dir => {
  for (const item of (await readdir(dir, {withFileTypes: true})).sort((a, b) => (a.name < b.name ? -1 : 1))) {
   const next = path.join(dir, item.name);
   if (item.isDirectory()) await collect(next);
   else tracked.push([next, await readFile(next, 'utf8')]);
  }
 };
 await collect(fixtures);
 await collect(path.join(scannerDir, 'discovery'));
 assert.ok(tracked.length > 20);

 for (const [name, text] of tracked) {
  // No address, and no host that is not the documentation-safe one.
  assert.equal(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text), false, name + ' must hold nothing that looks like an address');
  for (const host of text.match(/https?:\/\/[^\s"'\\)]+/g) ?? []) {
   assert.match(host, /^https:\/\/(example\.invalid|api\.github\.com)/, name + ' cites ' + host);
  }
 }
 const manifest = loadManifest(await load('v3-manifest.json'), 'fixture manifest');
 for (const [id, candidate] of manifest.candidates) {
  assert.match(id, /^[a-z0-9-]+$/, 'a fixture candidate id names a shape');
  for (const signal of candidate.signals) {
   assert.match(signal.observed, /^invented shape:/, id + ' signal must announce itself as invented');
  }
  // A manifest never carries contact state; at most it carries ids into contact-state.
  for (const contactId of candidate.contact_ids ?? []) assert.match(contactId, /-shape$/);
 }
});

// ---------------------------------------------------------------------------------------
// Validation value: what may and may not be concluded from public evidence.
// ---------------------------------------------------------------------------------------

// 10. The case this layer exists for.
test('paid localization work plus hands-on LQA is HIGH value on the payer axis', async () => {
 const hypothesis = defaultHypothesis();
 const verdict = valueForAxis('payer', normalizeSignals([
  {signal: 'PAID_LOCALIZATION_OFFERED', source: 'https://example.invalid/services', observed: 'invented shape: a rate card'},
  {signal: 'HANDS_ON_LQA', source: 'https://example.invalid/issues/1', observed: 'invented shape: files locale bugs'}
 ], 'signals'), hypothesis);
 assert.equal(verdict.value, 'HIGH');
 assert.equal(verdict.rule, 6);
 assert.equal(verdict.evidence.length, 2);
 for (const item of verdict.evidence) assert.match(item, /https:\/\/example\.invalid/, 'every reason cites a source');

 // And it is HIGH *because the payer axis is open*. Settle it and the same evidence is
 // worth nothing, which is the whole separation between "good" and "useful now".
 const settled = loadHypothesis(JSON.stringify({axes: {payer: {state: 'SETTLED', evidence: ['invented']}}}), 'h');
 const repeat = valueForAxis('payer', normalizeSignals([
  {signal: 'PAID_LOCALIZATION_OFFERED', source: 'https://example.invalid/services', observed: 'invented shape'},
  {signal: 'HANDS_ON_LQA', source: 'https://example.invalid/issues/1', observed: 'invented shape'}
 ], 'signals'), settled);
 assert.equal(repeat.value, 'LOW');
 assert.equal(repeat.rule, 1);
});

// 9. Free and volunteer work is not evidence of a payer, and one signal is not a case.
test('free or volunteer evidence alone never reaches payer HIGH', async () => {
 const hypothesis = defaultHypothesis();
 const only = ids => valueForAxis('payer', normalizeSignals(ids.map(cite), 'signals'), hypothesis);

 assert.deepEqual([only(['NONCOMMERCIAL_ONLY']).value, only(['NONCOMMERCIAL_ONLY']).rule], ['LOW', 3]);
 assert.deepEqual([only(['NONCOMMERCIAL_ONLY', 'VOLUNTEER_TRANSLATION_ONLY']).value], ['LOW']);
 // A repository that merely holds locale files says something about workflow, nothing
 // about paying for anything.
 assert.equal(only(['HANDLES_LOCALIZATION_FILES']).value, 'UNKNOWN');
 assert.equal(only(['PAID_LOCALIZATION_OFFERED']).value, 'LOW', 'one observation is an anecdote');
 // Contested evidence is capped: a rate card does not overrule "we take no money".
 const contested = only(['PAID_LOCALIZATION_OFFERED', 'FREELANCE_OR_STUDIO', 'NONCOMMERCIAL_ONLY']);
 assert.deepEqual([contested.value, contested.rule], ['MEDIUM', 5]);
 assert.equal(contested.weakening.length, 1);

 // No combination of signals in the whole vocabulary can push an axis past HIGH, and none
 // of the axis-neutral ones can move it at all.
 const everything = valueForAxis('payer', normalizeSignals(SIGNAL_IDS.map(cite), 'signals'), hypothesis);
 assert.equal(everything.value, 'MEDIUM', 'weakening evidence in the set caps the verdict');

 // The fixture case, end to end.
 const candidate = byId(await run())['volunteer-fan-translation'];
 assert.equal(candidate.validationValue.value, 'LOW');
 assert.equal(candidate.lane, 'RESERVE');
});

// 8. An absent answer is not a negative one and is never quietly counted as a positive.
test('UNKNOWN is never read as evidence in either direction', async () => {
 const verdict = valueForAxis('payer', [], defaultHypothesis());
 assert.equal(verdict.value, 'UNKNOWN');
 assert.equal(verdict.rule, 2);
 assert.deepEqual(verdict.evidence, []);
 assert.deepEqual(verdict.weakening, []);
 assert.match(verdict.reason, /nothing is assumed in either direction/);

 const candidate = byId(await run())['unevidenced-candidate'];
 assert.equal(candidate.validationValue.value, 'UNKNOWN');
 assert.equal(candidate.lane, 'HUMAN_REVIEW', 'an unknown goes to a person, not into the proposal lane');
 assert.equal(candidate.laneRule, 9);

 // UNKNOWN ranks below anything with evidence, and above evidence that argues against.
 const order = (await run()).candidates.filter(c => c.lane === 'HUMAN_REVIEW').map(c => c.validationValue.value);
 assert.deepEqual([...order].sort((a, b) => VALUES.indexOf(a) - VALUES.indexOf(b)), order.slice().sort((a, b) => VALUES.indexOf(a) - VALUES.indexOf(b)));
});

// 11. The things that are never inferred, whatever the evidence.
test('nothing about a person is inferred, stored or scored', async () => {
 // The vocabulary describes published work. No signal is about a person's circumstances.
 for (const id of SIGNAL_IDS) {
  for (const forbidden of FORBIDDEN_INFERENCES) {
   assert.equal(id.toLowerCase().includes(forbidden.split(' ')[0].toLowerCase()), false,
    id + ' must not name ' + forbidden);
  }
  assert.ok(SIGNALS[id].supports.length + SIGNALS[id].weakens.length > 0, id + ' must bear on some axis');
  for (const axis of [...SIGNALS[id].supports, ...SIGNALS[id].weakens]) assert.ok(VALIDATION_AXES.includes(axis));
  assert.ok(STRENGTHS.includes(SIGNALS[id].strength), id + ' must declare a known strength');
  assert.ok(SIGNAL_ORIGINS.includes(SIGNALS[id].origin), id + ' must declare where it can be seen');
  assert.ok(SIGNALS[id].description.length > 0, id + ' must say what it means');
 }

 // Every verdict, on every axis, carries the same unfilled unknown list.
 const report = await run();
 for (const candidate of report.candidates) {
  assert.deepEqual(candidate.validationValue.unknown, FORBIDDEN_INFERENCES);
  for (const axis of VALIDATION_AXES) {
   assert.deepEqual(candidate.validationValue.axes[axis].unknown, FORBIDDEN_INFERENCES);
  }
 }

 // And no *field* anywhere in the report predicts anything about anyone. The forbidden
 // words do appear in the report - in the `unknown` list, which is where they belong -
 // so the check is on the keys, not on the prose.
 const keys = new Set();
 const walkKeys = node => {
  if (Array.isArray(node)) return node.forEach(walkKeys);
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
   keys.add(key.toLowerCase());
   walkKeys(value);
  }
 };
 walkKeys(report);
 for (const forbidden of ['purchase_probability', 'will_buy', 'reply_probability', 'propensity',
  'lead_score', 'personality', 'income', 'seniority', 'budget_estimate', 'score', 'likelihood']) {
  assert.equal(keys.has(forbidden), false, 'the report must not carry a ' + forbidden + ' field');
 }
 const evaluated = evaluateValue(normalizeSignals(SIGNAL_IDS.map(cite), 's'), defaultHypothesis(), 'payer');
 assert.deepEqual(Object.keys(evaluated).sort(),
  ['axes', 'focusAxis', 'reason', 'rule', 'signalCount', 'unknown', 'value']);
});

// 7 (evidence discipline). A signal without a citation is not a signal.
test('a signal must cite a public source and be in the vocabulary', () => {
 assert.throws(() => normalizeSignals([{signal: 'PAYS_A_LOT', source: 'x', observed: 'y'}], 's'), SignalError);
 assert.throws(() => normalizeSignals([{signal: 'HANDS_ON_LQA', observed: 'y'}], 's'), SignalError);
 assert.throws(() => normalizeSignals([{signal: 'HANDS_ON_LQA', source: 'x'}], 's'), SignalError);
 assert.throws(() => normalizeSignals([{signal: 'HANDS_ON_LQA', source: ' ', observed: 'y'}], 's'), SignalError);
 assert.throws(() => normalizeSignals('nope', 's'), SignalError);

 // The same observation cited twice is one observation, so it cannot fake a second source.
 const twice = normalizeSignals([
  {signal: 'PAID_LOCALIZATION_OFFERED', source: 'https://example.invalid/a', observed: 'invented shape'},
  {signal: 'PAID_LOCALIZATION_OFFERED', source: 'https://example.invalid/a', observed: 'invented shape'}
 ], 's');
 assert.equal(twice.length, 1);
 assert.equal(valueForAxis('payer', twice, defaultHypothesis()).value, 'LOW');

 // Only two signals may ever be asserted by a machine; the payer-relevant ones are not
 // among them, by design.
 assert.deepEqual(MACHINE_DERIVABLE, ['CI_LOCALIZATION_STEP', 'HANDLES_LOCALIZATION_FILES']);
 for (const id of MACHINE_DERIVABLE) assert.equal(SIGNALS[id].supports.includes('payer'), false);
});

// ---------------------------------------------------------------------------------------
// Identity.
// ---------------------------------------------------------------------------------------

// 12. A shared name fragment is a question, never a merge.
test('an ambiguous identity is raised, never resolved', async () => {
 const report = byId(await run());
 for (const id of ['kagerou-north-port', 'kagerou-south-port']) {
  const candidate = report[id];
  assert.equal(candidate.identity.state, 'AMBIGUOUS');
  assert.deepEqual(candidate.identity.group, [id], 'an ambiguous pair is never merged into one group');
  assert.equal(candidate.lane, 'HUMAN_REVIEW');
  assert.equal(candidate.laneRule, 5);
  assert.equal(candidate.duplicateOf, null, 'ambiguity never produces a duplicate');
 }
 // Even though one of them has the strongest public evidence in the run.
 assert.equal(report['kagerou-north-port'].validationValue.value, 'HIGH');

 // Common words are not identity. Two unrelated localization projects are not the same party.
 const generic = resolveIdentities([
  {id: 'game-localization-tools', owner: 'alpha-org', aliases: []},
  {id: 'localization-game-toolkit', owner: 'beta-org', aliases: []}
 ]);
 assert.deepEqual(generic.map(item => item.state), ['MATCH', 'MATCH']);

 // And without a declared owner there is nothing to compare, which is not a match.
 const blank = resolveIdentities([{id: 'anonymous-repo', owner: null, aliases: []}]);
 assert.equal(blank[0].state, 'UNRESOLVED');
 assert.deepEqual(blank[0].group, ['anonymous-repo']);
});

// 13. Two repositories from one party are one contact.
test('a duplicate candidate is held, not dropped, and the stronger one is kept', async () => {
 const report = byId(await run());
 const duplicate = report['paid-studio-alpha-tools'];
 assert.equal(duplicate.identity.state, 'MATCH');
 assert.deepEqual(duplicate.identity.group, ['paid-studio-alpha', 'paid-studio-alpha-tools']);
 assert.equal(duplicate.duplicateOf, 'paid-studio-alpha');
 assert.equal(duplicate.lane, 'RESERVE');
 assert.equal(duplicate.laneRule, 7);
 assert.match(duplicate.release, /paid-studio-alpha/);
 // The one that is kept is the better-evidenced one, not the alphabetically first.
 assert.equal(report['paid-studio-alpha'].lane, 'READY_FOR_REVIEW');
 assert.equal(report['paid-studio-alpha'].duplicateOf, null);
});

// ---------------------------------------------------------------------------------------
// v2 behaviour that v3 must not soften.
// ---------------------------------------------------------------------------------------

// 2. A format the checker cannot read is not an absence of localization.
test('an unsupported format still reaches a human', async () => {
 const candidate = byId(await run())['unsupported-po-repo'];
 assert.equal(candidate.v2.rule, 8);
 assert.equal(candidate.lane, 'HUMAN_REVIEW');
 assert.deepEqual(candidate.v2.assets.unsupportedFormats, ['po']);
 assert.equal(candidate.v2.assets.assetCount, 2);
 assert.match(candidate.laneReason, /DETECTED_BUT_UNSUPPORTED/);
});

// 3. Typographic noise is not a reason to write to anyone, whatever else is true.
test('a noisy locale is never promoted by good public evidence', async () => {
 const candidate = byId(await run())['noisy-locale-repo'];
 assert.equal(candidate.v2.evidence.highConfidenceFindings, 0);
 assert.equal(candidate.v2.rule, 12);
 // Its public evidence is as strong as the proposed candidate's, and it changes nothing.
 assert.equal(candidate.validationValue.value, 'HIGH');
 assert.equal(candidate.lane, 'HUMAN_REVIEW');
 assert.equal(candidate.laneRule, 4);
 // The funnel does not credit it with a stage it never reached.
 assert.equal(stagesReached({prospect: candidate.v2, value: candidate.validationValue, queue: {name: candidate.lane}})
  .includes('highConfidence'), false);
});

// ---------------------------------------------------------------------------------------
// The hypothesis.
// ---------------------------------------------------------------------------------------

test('the hypothesis is an input, derived from contact-state rather than written down', async () => {
 const store = readContactStore(await load('v3-contacts.json'), 'fixture store');
 const derived = fromContactStore(store);
 assert.equal(derived.axes.problem.state, 'SETTLED');
 assert.equal(derived.axes.usefulness.state, 'SETTLED');
 assert.equal(derived.axes.payer.state, 'OPEN');
 assert.equal(derived.focusAxis, 'payer', 'the deepest open axis is asked first');
 assert.deepEqual(derived.openAxes, ['payer', 'workflow']);
 assert.deepEqual(derived.outstandingAxes, []);

 // Nothing about the current position is compiled in: a store where payer is answered
 // moves the focus without a code change.
 const answered = loadHypothesis(JSON.stringify({
  axes: Object.fromEntries(VALIDATION_AXES.map(axis => [axis, {state: 'SETTLED', evidence: ['invented shape']}]))
 }), 'h');
 assert.equal(answered.focusAxis, null);
 assert.deepEqual(answered.openAxes, []);

 // With nothing consulted, nothing is settled. That is the least presumptuous default,
 // not a claim that every axis is open.
 const blank = defaultHypothesis();
 assert.deepEqual(VALIDATION_AXES.map(axis => blank.axes[axis].state), VALIDATION_AXES.map(() => 'OPEN'));
 assert.match(blank.source, /nothing consulted/);

 // Only the store may say an answer is outstanding; a file cannot assert it.
 const claimed = loadHypothesis(JSON.stringify({axes: {payer: {state: 'OPEN', outstanding: true}}}), 'h');
 assert.deepEqual(claimed.outstandingAxes, []);
 assert.deepEqual(withOutstanding(claimed, ['payer']).outstandingAxes, ['payer']);

 assert.equal(focusOf(derived, 'workflow'), 'workflow', 'an explicit request wins');
 assert.equal(focusOf(derived, null), 'payer');

 for (const bad of ['{', '[]', '{"axes":{"price":{}}}', '{"schema":"other","axes":{}}',
  '{"axes":{"payer":{"state":"MAYBE"}}}', '{"axes":{"payer":[]}}', '{}']) {
  assert.throws(() => loadHypothesis(bad, 'h'), HypothesisError, bad);
 }
 for (const state of AXIS_STATES) {
  assert.equal(loadHypothesis(JSON.stringify({axes: {payer: {state}}}), 'h').axes.payer.state, state);
 }
});

test('an explicit hypothesis file overrides the derived one and says so', async () => {
 const report = await run({hypothesis: loadHypothesis(await load('v3-hypothesis.json'), 'fixture hypothesis')});
 assert.equal(report.hypothesis.axes.workflow.state, 'PARTIAL');
 assert.equal(report.hypothesis.focusAxis, 'payer');
 assert.match(report.hypothesis.source, /hypothesis/);
 assert.equal(report.summary.READY_FOR_REVIEW, 1);
});

// ---------------------------------------------------------------------------------------
// Exploration yield.
// ---------------------------------------------------------------------------------------

test('exploration yield is a prefix funnel with safe arithmetic', async () => {
 assert.deepEqual(conversion(0, 0), {numerator: 0, denominator: 0, rate: null, sample: 'NONE'});
 assert.deepEqual(conversion(3, 4), {numerator: 3, denominator: 4, rate: 0.75, sample: 'SMALL'});
 assert.equal(conversion(1, SMALL_SAMPLE).sample, 'OK');
 for (const [from, to] of CONVERSIONS) {
  assert.ok(STAGES.includes(from) && STAGES.includes(to), from + '->' + to);
 }

 const report = await run();
 for (const row of [report.yield.overall, ...report.yield.byStrategy]) {
  for (const [name, value] of Object.entries(row.conversions)) {
   assert.ok(value.rate === null || (value.rate >= 0 && value.rate <= 1), name + ' rate ' + value.rate);
   assert.ok(value.numerator <= value.denominator, name + ' cannot convert more than it had');
  }
 }
 // The denominator is what the explorer chewed through, not what survived to be evaluated.
 assert.equal(report.yield.overall.counts.discovered, 96);
 assert.equal(report.yield.overall.counts.localizationAssets, 10);

 // Two strategies, compared on efficiency rather than volume: the smaller one converts
 // better, which is the comparison the whole layer exists to make possible.
 const rows = Object.fromEntries(report.yield.byStrategy.map(row => [row.strategy_id, row]));
 assert.ok(rows['paid-localization'].conversions['discovered->humanReview'].rate >
  rows['volunteer-translation'].conversions['discovered->humanReview'].rate);
 for (const row of report.yield.byStrategy) {
  assert.equal(Object.values(row.lanes).reduce((a, b) => a + b, 0), 5);
 }

 // With no manifest there is no attribution, and the layer says so rather than inventing one.
 const bare = await review(workspace, {contacts: (await inputs()).contacts});
 assert.deepEqual(bare.yield.byStrategy.map(row => row.strategy_id), ['(unattributed)']);
 assert.equal(bare.yield.byStrategy[0].explored, null);
});

// ---------------------------------------------------------------------------------------
// 17. Determinism.
// ---------------------------------------------------------------------------------------

test('the same snapshot produces the same evaluation, byte for byte', async () => {
 const once = JSON.stringify(await run());
 const twice = JSON.stringify(await run());
 assert.equal(once, twice);
 assert.equal(renderText(await run()), renderText(await run()));

 // Nothing in the evaluation reads a clock or a random number.
 const sources = ['lib/review.mjs', 'lib/value.mjs', 'lib/queue.mjs', 'lib/yield.mjs', 'lib/identity.mjs',
  'lib/hypothesis.mjs', 'lib/signals.mjs', 'lib/manifest.mjs', 'review.mjs'];
 for (const name of sources) {
  const text = await readFile(path.join(scannerDir, name), 'utf8');
  for (const marker of ['Date.now(', 'new Date(', 'Math.random(', 'process.hrtime', 'performance.now']) {
   assert.equal(text.includes(marker), false, name + ' must not reference ' + marker);
  }
 }

 // And the manifest's own timestamp does not move a single verdict.
 const {contacts, manifest} = await inputs();
 const later = await review(workspace, {contacts, manifest: {...manifest, as_of: '2099-01-01T00:00:00Z'}});
 assert.deepEqual(later.candidates.map(c => [c.id, c.lane, c.laneRule]),
  (await run()).candidates.map(c => [c.id, c.lane, c.laneRule]));
});

// ---------------------------------------------------------------------------------------
// The manifest boundary.
// ---------------------------------------------------------------------------------------

test('the manifest is validated, round-trips, and feeds v2 its own metadata shape', async () => {
 const manifest = loadManifest(await load('v3-manifest.json'), 'fixture manifest');
 assert.equal(manifest.candidates.size, 10);

 // "nobody checked" and "checked, nothing there" survive the boundary as different claims.
 assert.equal(manifest.candidates.get('unchecked-contact-repo').contact_ids, undefined);
 assert.deepEqual(manifest.candidates.get('paid-studio-alpha').contact_ids, []);

 const metadata = toMetadata(manifest);
 assert.equal(metadata.schema, 'yn0-prospect-metadata-v1');
 assert.equal(metadata.prospects.get('unchecked-contact-repo').contact_ids, undefined);
 // v2 gets exactly the fields it already reads, and none of v3's.
 assert.deepEqual(Object.keys(metadata.prospects.get('paid-studio-alpha')).sort(),
  ['activity', 'activity_evidence', 'aliases', 'contact_ids', 'contact_route_evidence', 'notes', 'public_contact_route']);

 const round = normalizeManifest(serializeManifest(manifest), 'round trip');
 assert.equal(JSON.stringify(serializeManifest(round)), JSON.stringify(serializeManifest(manifest)));

 for (const bad of ['{', '[]', '{"schema":"other","candidates":{}}', '{"candidates":[]}', '{}',
  '{"candidates":{"a":{"nope":1}}}', '{"candidates":{"a":{}},"strategies":{}}',
  '{"candidates":{"a":{"discovery":{"tree_file_count":-1}}}}']) {
  assert.throws(() => loadManifest(bad, 'm'), ManifestError, bad);
 }
 // The fields v2 already owns are still validated by v2's own validator, which throws its
 // own error type. That is the point: there is one definition of what `activity` may be.
 for (const bad of ['{"candidates":{"a":{"activity":"BUSY"}}}',
  '{"candidates":{"a":{"signals":[{"signal":"NOPE","source":"s","observed":"o"}]}}}']) {
  assert.throws(() => loadManifest(bad, 'm'), Error, bad);
  assert.throws(() => loadManifest(bad, 'm'), error => !(error instanceof ManifestError), bad);
 }

 // Resume: an interrupted run merges onto what the last one found rather than replacing it.
 const previous = normalizeManifest({candidates: {'old-candidate': {owner: 'old-org', strategy_ids: ['a']}}}, 'prev');
 const merged = mergeManifests(previous, normalizeManifest({
  candidates: {'old-candidate': {owner: 'old-org', strategy_ids: ['b']}, 'new-candidate': {owner: 'new-org'}}
 }, 'next'));
 assert.deepEqual([...merged.candidates.keys()], ['new-candidate', 'old-candidate']);
 assert.deepEqual(merged.candidates.get('old-candidate').strategy_ids, ['a', 'b']);
});

// ---------------------------------------------------------------------------------------
// The explorer, driven by a fake client. No test here touches the network.
// ---------------------------------------------------------------------------------------

// A synthetic GitHub. Every repository it returns is invented, and it counts every call so
// a test can assert what the budget actually permitted.
function fakeGitHub({repositoryCount = 4, perPage = 30, trees = {}, files = {}} = {}) {
 const calls = {search: 0, tree: 0, file: 0};
 const repositories = Array.from({length: repositoryCount}, (_, index) => ({
  fullName: 'example-org-' + index + '/invented-repo-' + index,
  owner: 'example-org-' + index,
  name: 'invented-repo-' + index,
  url: 'https://example.invalid/example-org-' + index + '/invented-repo-' + index,
  defaultBranch: 'main',
  description: 'invented shape',
  topics: ['localization'],
  archived: false,
  fork: false,
  hasIssues: true,
  pushedAt: '2026-09-10T00:00:00Z',
  size: 10,
  license: 'MIT',
  homepage: null
 }));
 const defaultTree = [
  {path: 'locales/en.json', size: 40},
  {path: 'locales/ja.json', size: 40},
  {path: '.github/workflows/i18n-check.yml', size: 20},
  {path: 'src/index.js', size: 100}
 ];
 return {
  calls,
  repositories,
  async searchRepositories(query, {page = 1} = {}) {
   calls.search++;
   const start = (page - 1) * perPage;
   return {total: repositories.length, incomplete: false, remaining: 100, repositories: repositories.slice(start, start + perPage)};
  },
  async listTree(fullName) {
   calls.tree++;
   return {remaining: 100, truncated: false, paths: trees[fullName] ?? defaultTree};
  },
  async getFile(fullName, ref, filePath) {
   calls.file++;
   return {remaining: 100, text: files[filePath] ?? JSON.stringify({greeting: 'invented shape'})};
  }
 };
}

const memoryWriter = () => {
 const written = new Map();
 return {written, async write(relPath, text) {
  written.set(relPath.split(path.sep).join('/'), text);
 }};
};

const strategy = (id, query, extra = {}) => ({strategy_id: id, source: 'github_search_repositories', query, per_page: 30, rationale: null, enabled: true, sort: null, order: 'desc', ...extra});

test('exploration writes a manifest and a workspace, and nothing else', async () => {
 const client = fakeGitHub({repositoryCount: 3});
 const writer = memoryWriter();
 const result = await explore({
  client,
  strategies: [strategy('invented-route', 'invented shape')],
  budget: new Budget(),
  writer,
  asOf: '2026-09-19T00:00:00Z'
 });
 const manifest = normalizeManifest(result.manifest, 'explored');
 assert.equal(manifest.candidates.size, 3);
 assert.equal(manifest.as_of, '2026-09-19T00:00:00Z');

 const candidate = manifest.candidates.get('example-org-0__invented-repo-0');
 assert.equal(candidate.repository, 'example-org-0/invented-repo-0');
 assert.equal(candidate.owner, 'example-org-0');
 assert.deepEqual(candidate.strategy_ids, ['invented-route']);
 assert.equal(candidate.activity, 'ACTIVE');
 assert.equal(candidate.public_contact_route, 'GITHUB_ISSUE');
 // The claim the explorer may never make.
 assert.equal(candidate.contact_ids, undefined, 'discovery never claims a contact was checked');
 // Only the two repository-derived signals, both citing a file it actually read.
 assert.deepEqual(candidate.signals.map(item => item.signal), ['CI_LOCALIZATION_STEP', 'HANDLES_LOCALIZATION_FILES']);
 for (const item of candidate.signals) assert.match(item.source, /^https:\/\/example\.invalid\//);

 // Only localization files are pulled down; source files are not.
 assert.deepEqual([...writer.written.keys()].sort(), [
  'example-org-0__invented-repo-0/locales/en.json', 'example-org-0__invented-repo-0/locales/ja.json',
  'example-org-1__invented-repo-1/locales/en.json', 'example-org-1__invented-repo-1/locales/ja.json',
  'example-org-2__invented-repo-2/locales/en.json', 'example-org-2__invented-repo-2/locales/ja.json'
 ]);

 // A repository with no description must still produce a valid manifest entry. An optional
 // field with nothing in it is absent, never a `null` the validator rejects.
 const bare = fakeGitHub({repositoryCount: 1});
 bare.repositories[0].description = null;
 const bareResult = await explore({
  client: bare,
  strategies: [strategy('invented-route', 'invented shape')],
  budget: new Budget(),
  writer: memoryWriter(),
  asOf: '2026-09-19T00:00:00Z'
 });
 const bareManifest = normalizeManifest(bareResult.manifest, 'explored');
 assert.equal(bareManifest.candidates.size, 1);
 assert.equal(bareManifest.candidates.get('example-org-0__invented-repo-0').notes, null);

 const counters = manifest.strategies[0];
 assert.equal(counters.discovered_count, 3);
 assert.equal(counters.inspected_count, 3);
 assert.equal(counters.ja_locale_count, 3);
 assert.equal(counters.materialized_count, 3);
});

// 18. The budget is a ceiling, not a suggestion, and running out is not a crash.
test('exploration never exceeds its budget and stops cleanly when it runs out', async () => {
 const client = fakeGitHub({repositoryCount: 500, perPage: 30});
 const budget = new Budget({requests: 6, repositories: 25, inspections: 2, candidates: 1, files: 4, pages: 1});
 const strategies = [strategy('a', 'invented shape'), strategy('b', 'invented shape')];
 const result = await explore({
  client,
  strategies,
  budget,
  writer: memoryWriter(),
  asOf: '2026-09-19T00:00:00Z'
 });
 for (const key of LIMIT_KEYS) {
  assert.ok(budget.spent[key] <= budget.limits[key], key + ' spent ' + budget.spent[key] + ' of ' + budget.limits[key]);
 }
 // Pages are capped per strategy, not across the run - otherwise the first strategy spends
 // every later strategy's pages and the yield table compares nothing.
 assert.ok(budget.spent.pages <= budget.limits.pages * strategies.length);
 assert.ok(client.calls.search + client.calls.tree + client.calls.file <= 6, 'no request beyond the request budget');
 assert.ok(budget.truncated);
 assert.match(budget.reason, /budget exhausted/);

 const manifest = normalizeManifest(result.manifest, 'explored');
 assert.ok(manifest.candidates.size <= 1);
 // Truncation is reported rather than hidden, so the yield table cannot read a short run
 // as a bad strategy.
 assert.ok(manifest.strategies.every(row => row.truncated && row.truncated_reason));

 assert.throws(() => new Budget({nonsense: 1}), /unknown budget limit/);
 assert.throws(() => new Budget({requests: -1}), /non-negative/);
 assert.equal(new Budget({requests: 1}).spend('requests', 2), false);
 assert.deepEqual(Object.keys(DEFAULT_BUDGET).sort(), Object.keys(new Budget().spent).sort());
 assert.throws(() => new Budget().spend('pages'), /unknown budget limit/, 'a per-strategy cap is not spendable');
 assert.throws(() => new Budget().record('requests'), /not a per-strategy limit/);
 assert.deepEqual(PER_STRATEGY_LIMITS, ['pages']);

 // Every strategy gets its own pages, so a one-page cap does not silence the later ones.
 const fair = fakeGitHub({repositoryCount: 60, perPage: 30});
 const fairBudget = new Budget({pages: 1});
 const spread = await explore({
  client: fair,
  strategies: [strategy('a', 'invented shape'), strategy('b', 'invented shape'), strategy('c', 'invented shape')],
  budget: fairBudget,
  writer: memoryWriter(),
  asOf: '2026-09-19T00:00:00Z'
 });
 assert.equal(fair.calls.search, 3, 'each strategy got its page');
 assert.equal(fairBudget.spent.pages, 3);
 for (const row of normalizeManifest(spread.manifest, 'explored').strategies) {
  assert.equal(row.discovered_count, 30, row.strategy_id + ' must get its own page of results');
 }
});

test('exploration survives a failing search and a failing tree listing', async () => {
 const client = fakeGitHub({repositoryCount: 2});
 client.searchRepositories = async () => {
  const error = new Error('invented shape: rate limited');
  error.rateLimited = true;
  throw error;
 };
 const result = await explore({
  client,
  strategies: [strategy('a', 'invented shape')],
  budget: new Budget(),
  writer: memoryWriter(),
  asOf: '2026-09-19T00:00:00Z'
 });
 const manifest = normalizeManifest(result.manifest, 'explored');
 assert.equal(manifest.candidates.size, 0);
 assert.match(manifest.strategies[0].truncated_reason, /search failed/);
 assert.ok(result.log.some(line => line.includes('rate limited')));

 // A repository that cannot be listed is skipped, and the rest of the run continues.
 const partial = fakeGitHub({repositoryCount: 2});
 const original = partial.listTree.bind(partial);
 partial.listTree = async (fullName, ref) => {
  if (fullName.endsWith('-0')) throw new Error('invented shape: tree unavailable');
  return original(fullName, ref);
 };
 const second = await explore({
  client: partial,
  strategies: [strategy('a', 'invented shape')],
  budget: new Budget(),
  writer: memoryWriter(),
  asOf: '2026-09-19T00:00:00Z'
 });
 assert.equal(normalizeManifest(second.manifest, 'explored').candidates.size, 1);
});

test('exploration drops forks, archives and repositories without Japanese before spending on them', async () => {
 const client = fakeGitHub({repositoryCount: 4, trees: {
  'example-org-2/invented-repo-2': [{path: 'locales/en.json', size: 10}],
  'example-org-3/invented-repo-3': [{path: 'src/index.js', size: 10}]
 }});
 client.repositories[0].fork = true;
 client.repositories[1].archived = true;
 const result = await explore({
  client,
  strategies: [strategy('a', 'invented shape')],
  budget: new Budget(),
  writer: memoryWriter(),
  asOf: '2026-09-19T00:00:00Z'
 });
 const manifest = normalizeManifest(result.manifest, 'explored');
 assert.equal(manifest.candidates.size, 0, 'nothing here is worth a download');
 assert.equal(client.calls.tree, 2, 'the fork and the archive never cost a request');
 assert.equal(client.calls.file, 0);
 const row = manifest.strategies[0];
 assert.deepEqual([row.discovered_count, row.skipped_count, row.inspected_count, row.localization_asset_count, row.ja_locale_count],
  [4, 2, 2, 1, 0]);
});

test('activity, contact route and machine signals are derived only from what was read', () => {
 const asOf = '2026-09-19T00:00:00Z';
 assert.equal(activityOf('2026-09-10T00:00:00Z', asOf).activity, 'ACTIVE');
 assert.equal(activityOf('2026-05-01T00:00:00Z', asOf).activity, 'MAINTAINED');
 assert.equal(activityOf('2022-01-01T00:00:00Z', asOf).activity, 'DORMANT');
 assert.equal(activityOf(null, asOf).activity, 'UNKNOWN');
 assert.equal(activityOf('not a date', asOf).activity, 'UNKNOWN');

 assert.equal(contactRouteOf({archived: true, hasIssues: true}).public_contact_route, 'NONE');
 assert.equal(contactRouteOf({archived: false, hasIssues: true}).public_contact_route, 'GITHUB_ISSUE');
 // Not NONE: issues being off is not proof that no public route exists.
 assert.equal(contactRouteOf({archived: false, hasIssues: false}).public_contact_route, 'UNKNOWN');

 const repository = {url: 'https://example.invalid/o/r', defaultBranch: 'main'};
 assert.deepEqual(machineSignals(repository, [], []), []);
 assert.deepEqual(machineSignals(repository, [{path: 'locales/ja.json'}], []).map(item => item.signal),
  ['HANDLES_LOCALIZATION_FILES']);
 assert.deepEqual(machineSignals(repository, [{path: 'locales/ja.json'}], ['.github/workflows/release.yml'])
  .map(item => item.signal), ['HANDLES_LOCALIZATION_FILES']);
 assert.deepEqual(machineSignals(repository, [{path: 'locales/ja.json'}], ['.github/workflows/i18n.yml'])
  .map(item => item.signal), ['HANDLES_LOCALIZATION_FILES', 'CI_LOCALIZATION_STEP']);

 assert.equal(candidateId('Example-Org/Some.Repo'), 'example-org__some.repo');
});

// Calibration, phase 2. v3 ranked every search by `sort=updated`, which is a ranking by
// churn rather than by the query: on a broad text query the repositories pushed most
// recently are the ones a robot pushes. How a route ranks is now the route's own declared
// property, so it can be compared like the query it belongs to.
test('how a search ranks belongs to the strategy, not to the client', async () => {
 assert.equal(normalizeStrategy({strategy_id: 'a', query: 'x'}, 's').sort, null,
  'the default is the search\'s own relevance ranking');
 assert.equal(normalizeStrategy({strategy_id: 'a', query: 'x'}, 's').order, 'desc');
 assert.equal(normalizeStrategy({strategy_id: 'a', query: 'x', sort: 'updated'}, 's').sort, 'updated');
 assert.throws(() => normalizeStrategy({strategy_id: 'a', query: 'x', sort: 'best-match'}, 's'), StrategyError);
 assert.throws(() => normalizeStrategy({strategy_id: 'a', query: 'x', order: 'random'}, 's'), StrategyError);
 assert.ok(SORTS.includes(null));

 // The client asks for exactly what the strategy declared, and asks for nothing when the
 // strategy declared nothing.
 const asked = [];
 const transport = async url => {
  asked.push(new URL(url).searchParams);
  return {ok: true, status: 200, headers: {get: () => null}, json: async () => ({items: []}), text: async () => ''};
 };
 const client = createClient({transport, env: {}});
 await client.searchRepositories('q');
 assert.equal(asked[0].get('sort'), null, 'no sort parameter is GitHub\'s documented best match');
 assert.equal(asked[0].get('order'), null);
 await client.searchRepositories('q', {sort: 'updated', order: 'asc'});
 assert.deepEqual([asked[1].get('sort'), asked[1].get('order')], ['updated', 'asc']);

 // And the explorer passes the strategy's ranking down, then records it beside the query,
 // because the same query ranked two ways is two different first pages.
 const seen = [];
 const github = fakeGitHub({repositoryCount: 1});
 const recording = {...github, searchRepositories: async (query, options) => {
  seen.push(options);
  return github.searchRepositories(query, options);
 }};
 const result = await explore({
  client: recording,
  strategies: [strategy('ranked-route', 'invented shape', {sort: 'updated', order: 'desc'})],
  budget: new Budget(),
  writer: memoryWriter(),
  asOf: '2026-09-19T00:00:00Z'
 });
 assert.deepEqual([seen[0].sort, seen[0].order], ['updated', 'desc']);
 const row = normalizeManifest(result.manifest, 'explored').strategies[0];
 assert.deepEqual([row.sort, row.order], ['updated', 'desc']);
});

// Calibration, phase 3. Each of these is a measured failure of the v3 set, written down as
// a rule so the next edit to strategies.json has to argue with it.
test('every shipped strategy rests on structural evidence rather than README prose', async () => {
 const text = await readFile(path.join(scannerDir, 'discovery', 'strategies.json'), 'utf8');
 const strategies = loadStrategies(text, 'shipped strategies');

 for (const item of strategies) {
  // A README mentions everything. Matching one is how a curated list of links about game
  // localization outranks a game that has some: 61% of what the v3 set returned was an
  // awesome-list, a star-list mirror or an SEO landing repository.
  assert.doesNotMatch(item.query, /in:[a-z,]*readme/, item.strategy_id + ' must not match on README text');

  // Something in every query has to reach a field the owner declared rather than prose
  // they happened to write: a topic filter, the topics field itself, or a language
  // GitHub's linguist assigned.
  assert.match(item.query, /(^|\s)(topic:|language:)|in:[a-z,]*topics/,
   item.strategy_id + ' must carry structural evidence');

  // `language:JSON` is the shape that looks structural and is not: linguist decides a
  // repository's language, and it decides JSON for almost nothing, so the route that
  // carried it had a population of one.
  assert.doesNotMatch(item.query, /language:JSON/i, item.strategy_id + ' must not filter on a data-file language');

  // Ranking is left to the search unless a route has a measured reason to override it.
  assert.equal(item.sort, null, item.strategy_id + ' ranks by relevance');
 }

 // Two topics are ANDed, and so is free text next to a topic - which is how v3's
 // `indie game i18n topic:localization` came to match nothing at all. Any route that
 // narrows with both has to be able to say it still returns something, so the set keeps
 // routes of both shapes rather than only the narrow ones.
 const topicOnly = strategies.filter(item => !/in:name/.test(item.query));
 const textAndTopic = strategies.filter(item => /in:name/.test(item.query));
 assert.ok(topicOnly.length >= 3, 'the set keeps self-labelled routes');
 assert.ok(textAndTopic.length >= 3, 'and routes that read the name and description');
});

test('the shipped strategy set loads and every strategy is comparable', async () => {
 const text = await readFile(path.join(scannerDir, 'discovery', 'strategies.json'), 'utf8');
 const strategies = loadStrategies(text, 'shipped strategies');
 assert.ok(strategies.length >= 6);
 const ids = strategies.map(item => item.strategy_id);
 assert.deepEqual(ids, [...ids].sort(), 'strategies run in a deterministic order');
 assert.deepEqual([...new Set(ids)], ids, 'strategy ids are unique');
 for (const item of strategies) {
  assert.match(item.strategy_id, /^[a-z0-9-]+$/);
  assert.ok(item.query.length > 0);
  assert.ok(item.rationale, item.strategy_id + ' must say why it is worth trying');
 }
 for (const bad of ['{', '[]', '{"strategies":{}}', '{"schema":"other","strategies":[]}',
  '{"strategies":[{"query":"x"}]}', '{"strategies":[{"strategy_id":"a","query":"x","per_page":0}]}',
  '{"strategies":[{"strategy_id":"a","query":"x"},{"strategy_id":"a","query":"y"}]}',
  '{"strategies":[{"strategy_id":"a","query":"x","source":"scraper"}]}']) {
  assert.throws(() => loadStrategies(bad, 's'), StrategyError, bad);
 }
});

// ---------------------------------------------------------------------------------------
// End to end, on real files, through the CLI surface.
// ---------------------------------------------------------------------------------------

test('an explored workspace can be reviewed offline, and nothing is written outside it', async () => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'yn0-v3-'));
 try {
  const client = fakeGitHub({repositoryCount: 2, files: {
   'locales/en.json': JSON.stringify({greeting: 'Hello, {name}!'}),
   'locales/ja.json': JSON.stringify({greeting: 'こんにちは！'})
  }});
  const {fileWriter} = await import('../discovery/lib/explore.mjs');
  const result = await explore({
   client,
   strategies: [strategy('invented-route', 'invented shape')],
   budget: new Budget(),
   writer: fileWriter(root),
   asOf: '2026-09-19T00:00:00Z'
  });
  const manifest = normalizeManifest(result.manifest, 'explored');
  assert.equal(manifest.candidates.size, 2);
  assert.ok((await stat(path.join(root, 'example-org-0__invented-repo-0', 'locales', 'ja.json'))).isFile());

  const report = await review(root, {manifest, contacts: (await inputs()).contacts});
  assert.equal(report.candidateCount, 2);
  // A candidate discovery found but nobody has checked against the contact store cannot be
  // proposed, however good it looks. That is the whole gate, end to end.
  for (const candidate of report.candidates) {
   assert.equal(candidate.v2.contactPosture, 'UNCHECKED');
   assert.notEqual(candidate.lane, 'READY_FOR_REVIEW');
   assert.equal(candidate.v2.evidence.highConfidenceFindings, 1, 'the mechanical finding survived the round trip');
  }
  assert.ok(renderText(report).includes('contacts anyone'));
 } finally {
  await rm(root, {recursive: true, force: true});
 }
});

test('CLI argument parsing', () => {
 assert.equal(parseArgs(['work']).options.format, 'text');
 const parsed = parseArgs(['work', '--single', '--format', 'json', '--asking', 'payer', '--lane', 'RESERVE',
  '--manifest', 'm.json', '--hypothesis', 'h.json', '--samples', '2', '--min-completeness', '0.5']);
 assert.equal(parsed.target, 'work');
 assert.deepEqual([parsed.options.single, parsed.options.asking, parsed.options.lane], [true, 'payer', 'RESERVE']);
 assert.deepEqual([parsed.options.manifest, parsed.options.hypothesis], ['m.json', 'h.json']);
 assert.deepEqual(parsed.options.thresholds, {minCompleteness: 0.5});
 assert.deepEqual(parseArgs(['--help']), {help: true});
 for (const argv of [[], ['a', 'b'], ['w', '--format', 'yaml'], ['w', '--asking', 'price'],
  ['w', '--lane', 'CONTACT'], ['w', '--nope'], ['w', '--samples', 'x'], ['w', '--manifest']]) {
  assert.throws(() => parseArgs(argv), Error, JSON.stringify(argv));
 }
 for (const lane of LANES) assert.equal(parseArgs(['w', '--lane', lane]).options.lane, lane);

 // The explorer refuses to run without somewhere to put what it finds.
 assert.deepEqual(parseExploreArgs(['--help']), {help: true});
 assert.equal(parseExploreArgs(['--plan']).options.plan, true);
 const explorer = parseExploreArgs(['--workspace', 'w', '--out', 'm.local.json', '--max-inspections', '5']);
 assert.deepEqual([explorer.options.workspace, explorer.options.out], ['w', 'm.local.json']);
 assert.deepEqual(explorer.options.limits, {inspections: 5});
 for (const argv of [['--workspace', 'w'], ['--out', 'm.json'], ['--nope'], ['--workspace'],
  ['--workspace', 'w', '--out', 'm.json', '--max-pages', 'x']]) {
  assert.throws(() => parseExploreArgs(argv), Error, JSON.stringify(argv));
 }
});

test('the review refuses a path that is not a directory', async () => {
 await assert.rejects(() => review(path.join(workspace, 'does-not-exist')));
 await assert.rejects(() => review(path.join(workspace, 'paid-studio-alpha', 'locales', 'en.json')), /not a directory/);
});
