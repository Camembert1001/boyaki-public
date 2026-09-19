// Tests for the real contact store integration. Run with:
//   node --test internal/distribution-scanner/tests/contact-store.test.mjs
//
// Everything here is synthetic. Every contact id names a conversation shape, every name
// is `Prospect <letter>`, every handle is a placeholder, and no test in this file reads a
// real store, touches the network, or contacts anybody.
//
// The property under test is one-directional and the asymmetry is the whole point:
//
//   calling two strangers the same party  ->  a human reads for five minutes
//   calling a burned contact a stranger   ->  the relationship is spent, silently
//
// So every case below asks the same question: can this input make the engine say
// "never contacted" about somebody it should not? The answer has to be no for a missing
// store, an unreadable one, a malformed one, an unindexed one, an unidentifiable
// candidate, a similar-looking name, and a human declaration the store disagrees with.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

import {ContactStateError, identityKeys, normalizeAlias, normalizeIdentity} from '../../contact-state/lib/model.mjs';
import {identityCoverage} from '../../contact-state/lib/store.mjs';
import {
 CONCLUSIONS, POSTURES, loadContactStoreFile, nearMatches, readContactStore, resolvePosture
} from '../lib/contact-link.mjs';
import {
 MATCH_STATES, buildIndex, isIdentifiable, matchProspect, prospectIdentity
} from '../lib/contact-match.mjs';
import {loadMetadata} from '../lib/metadata.mjs';
import {loadManifest, toMetadata} from '../lib/manifest.mjs';
import {discover} from '../lib/prospects.mjs';
import {review} from '../lib/review.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const scannerDir = path.join(here, '..');
const repoRoot = path.join(scannerDir, '..', '..');
const fixtures = path.join(scannerDir, 'prospect-fixtures');
const workspace = path.join(fixtures, 'v3-workspace');

const load = async name => readFile(path.join(fixtures, name), 'utf8');
const indexedStore = async () => readContactStore(await load('v3-contacts-indexed.json'), 'indexed fixture store');
const opaqueStore = async () => readContactStore(await load('v3-contacts.json'), 'opaque fixture store');
const manifest = async () => loadManifest(await load('v3-manifest.json'), 'fixture manifest');

// The v3 manifest with every human-declared contact link removed, so the automatic
// lookup is the only thing deciding contact history.
const undeclared = async () => {
 const metadata = toMetadata(await manifest());
 for (const entry of metadata.prospects.values()) entry.contact_ids = undefined;
 return metadata;
};

const byId = report => Object.fromEntries(report.prospects.map(prospect => [prospect.id, prospect]));

const store = async contacts => readContactStore(JSON.stringify({schema: 'yn0-contact-state-v1', contacts}), 'inline store');

// One indexed contact, in whatever conversation shape the test needs.
const contact = (id, identity, events) => ({
 id, name: 'Prospect Z', organization: 'Example test shape', channel: 'OTHER', identity, events
});

const sent = {type: 'OUTREACH_SENT', at: '2026-09-01T09:00:00Z', waiting_for: 'FIRST_REPLY'};

const resolve = async (contacts, candidate) => resolvePosture(await store(contacts), undefined, [candidate.id], candidate);

// ---------------------------------------------------------------------------------------
// 1-2. The two answers that must never be confused.
// ---------------------------------------------------------------------------------------

// 1. No store, no claim. Not having looked is not a finding.
test('without a contact store nothing is checked and nothing can be proposed', async () => {
 const verdict = resolvePosture(null, [], ['anything'], {id: 'anything', owner: 'example-org'});
 assert.equal(verdict.posture, 'UNCHECKED');
 assert.equal(verdict.conclusion, 'NOT_CONSULTED');
 assert.equal(verdict.matchState, null);
 assert.match(verdict.reason, /no contact store was provided/);

 const report = await discover(workspace, {metadata: await undeclared()});
 assert.equal(report.summary.READY_FOR_REVIEW, 0);
 for (const prospect of report.prospects) {
  assert.notEqual(prospect.verdict, 'READY_FOR_REVIEW');
  assert.equal(prospect.contact.conclusion, 'NOT_CONSULTED');
 }
});

// 2. A store that can answer, asked about somebody who is not in it. This is the only
// path to NEVER_CONTACTED that does not go through a human's own claim, and it is what
// the whole exercise was for: before this, an undeclared candidate was UNCHECKED forever.
test('a fully indexed store can say "checked, and this party is new"', async () => {
 const contacts = await indexedStore();
 assert.equal(identityCoverage(contacts).complete, true);

 const verdict = resolvePosture(contacts, undefined, ['unchecked-contact-repo'], {
  id: 'unchecked-contact-repo',
  owner: 'example-unchecked-org',
  repository: 'example-unchecked-org/unchecked-contact-repo',
  url: 'https://example.invalid/example-unchecked-org/unchecked-contact-repo'
 });
 assert.equal(verdict.posture, 'NEVER_CONTACTED');
 assert.equal(verdict.conclusion, 'NO_MATCH');
 assert.equal(verdict.matchState, 'NO_MATCH');
 assert.deepEqual(verdict.contactIds, []);

 // End to end, the candidate that used to be stuck at UNCHECKED now reaches a human.
 const report = await review(workspace, {manifest: await manifest(), contacts});
 const candidate = report.candidates.find(item => item.id === 'unchecked-contact-repo');
 assert.equal(candidate.v2.contactPosture, 'NEVER_CONTACTED');
 assert.equal(candidate.v2.contactConclusion, 'NO_MATCH');
 assert.equal(candidate.lane, 'READY_FOR_REVIEW');
});

// ---------------------------------------------------------------------------------------
// 3. What counts as recognizing somebody.
// ---------------------------------------------------------------------------------------

test('an exact identifier matches, and only an exact identifier does', async () => {
 const contacts = await store([
  contact('login-shape', {github_logins: ['example-handle-a']}, [sent]),
  contact('repository-shape', {repositories: ['example-handle-b/prospect-b-game']}, [sent]),
  contact('alias-shape', {aliases: ['Harbour Chronicle Remastered']}, [sent]),
  contact('domain-shape', {domains: ['prospect-d.example']}, [sent]),
  contact('email-shape', {emails: ['prospect-e@prospect-e.example']}, [sent]),
  contact('manual-shape', {manual_links: ['some-candidate-id']}, [sent])
 ]);
 const index = buildIndex(contacts);
 const match = candidate => matchProspect(index, prospectIdentity(candidate));

 assert.deepEqual(match({id: 'x', owner: 'example-handle-a'}).contactIds, ['login-shape']);
 assert.deepEqual(match({id: 'x', owner: 'example-handle-b', repository: 'prospect-b-game'}).contactIds, ['repository-shape']);
 assert.deepEqual(match({id: 'x', aliases: ['harbour   chronicle  remastered']}).contactIds, ['alias-shape']);
 assert.deepEqual(match({id: 'x', url: 'https://prospect-d.example/game'}).contactIds, ['domain-shape']);
 assert.deepEqual(match({id: 'x', emails: ['Prospect-E@Prospect-E.Example']}).contactIds, ['email-shape']);
 assert.deepEqual(match({id: 'some-candidate-id'}).contactIds, ['manual-shape']);

 // A GitHub URL names its owner and repository; any other host names only itself.
 assert.deepEqual(match({id: 'x', url: 'https://github.com/example-handle-b/prospect-b-game'}).contactIds, ['repository-shape']);
 // The same path under another host names nobody: it raises a hand at most, and the
 // hand raised is not a match.
 const elsewhere = match({id: 'x', url: 'https://unrelated.example/example-handle-a/thing'});
 assert.notEqual(elsewhere.state, 'MATCHED');
 assert.deepEqual(elsewhere.contactIds, []);

 // The matched kinds are reported; the matched values never are, so no identifier can
 // travel from the store into a report.
 const evidence = match({id: 'x', owner: 'example-handle-a'});
 assert.deepEqual(evidence.evidence, [{contactId: 'login-shape', kind: 'github_login'}]);
 assert.equal(JSON.stringify(evidence.evidence).includes('example-handle-a'), false);
 for (const state of [evidence.state, match({id: 'nobody', owner: 'nobody-at-all'}).state]) {
  assert.ok(MATCH_STATES.includes(state), state);
 }
});

test('one party reached on two channels resolves to both records, most restrictive first', async () => {
 const contacts = await store([
  contact('mail-thread-shape', {github_logins: ['example-handle-a']}, [sent]),
  contact('issue-thread-shape', {github_logins: ['example-handle-a']}, [
   sent, {type: 'OPT_OUT', at: '2026-09-02T09:00:00Z'}
  ])
 ]);
 const verdict = resolvePosture(contacts, undefined, ['x'], {id: 'x', owner: 'example-handle-a'});
 assert.deepEqual(verdict.contactIds, ['issue-thread-shape', 'mail-thread-shape']);
 assert.equal(verdict.posture, 'DO_NOT_CONTACT');
});

// ---------------------------------------------------------------------------------------
// 4-8. Every state a known contact can be in, and what it blocks.
// ---------------------------------------------------------------------------------------

// 4. A conversation that is over does not start again from the discovery side.
test('a CLOSED contact is recognized and blocked', async () => {
 const verdict = await resolve([
  contact('closed-shape', {github_logins: ['example-closed-org']}, [
   sent,
   {type: 'INBOUND_REPLY', at: '2026-09-02T09:00:00Z'},
   {type: 'CONVERSATION_ENDED', at: '2026-09-03T09:00:00Z', direction: 'outbound'}
  ])
 ], {id: 'closed-repo', owner: 'example-closed-org'});
 assert.equal(verdict.posture, 'INBOUND_ONLY');
 assert.equal(verdict.conclusion, 'MATCHED');
 assert.equal(verdict.linkSource, 'MATCHED');
 assert.match(verdict.reason, /reopens only on inbound/);
});

// 5. Opting out is the strongest answer in the store and outranks everything.
test('a DO_NOT_CONTACT contact is recognized and blocked', async () => {
 const verdict = await resolve([
  contact('opted-out-shape', {github_logins: ['example-optout-org']}, [
   sent, {type: 'OPT_OUT', at: '2026-09-02T09:00:00Z'}
  ])
 ], {id: 'optout-repo', owner: 'example-optout-org'});
 assert.equal(verdict.posture, 'DO_NOT_CONTACT');

 const report = byId(await discover(workspace, {
  contacts: await indexedStore(),
  metadata: await undeclared()
 }));
 assert.equal(report['opted-out-repo'].contact.posture, 'DO_NOT_CONTACT');
 assert.equal(report['opted-out-repo'].verdict, 'IGNORE');
 assert.equal(report['opted-out-repo'].rule, 1);
});

// 6. An answer we are already waiting for is a reason to hold this party, not to write.
test('an AWAITING_REPLY contact is recognized and blocked', async () => {
 const verdict = await resolve([
  contact('awaiting-shape', {github_logins: ['example-waiting-org']}, [sent])
 ], {id: 'waiting-repo', owner: 'example-waiting-org'});
 assert.equal(verdict.posture, 'AWAITING_REPLY');

 const report = byId(await discover(workspace, {
  contacts: await indexedStore(),
  metadata: await undeclared()
 }));
 // north-harbor-games is the indexed store's awaiting-first-reply shape.
 assert.equal(report['kagerou-north-port'].contact.posture, 'AWAITING_REPLY');
 assert.equal(report['kagerou-north-port'].verdict, 'IGNORE');
 assert.equal(report['kagerou-north-port'].rule, 3);
});

// 7. The Prospect Burn rule that is not about any one party: while the payer question is
// outstanding somewhere, a second stranger asked the same question buys nothing. The
// candidate is held, not dropped.
test('a matched party on an outstanding axis holds other candidates in RESERVE', async () => {
 const contacts = readContactStore(await load('v3-contacts-payer-open.json'), 'payer-open fixture store');
 const report = await review(workspace, {manifest: await manifest(), contacts});
 assert.deepEqual(report.contactStore.outstandingAxes, ['payer']);
 assert.equal(report.hypothesis.focusAxis, 'payer');
 assert.ok(report.summary.RESERVE > 0, 'candidates are held rather than dropped');
 assert.equal(report.summary.READY_FOR_REVIEW, 0, 'nobody is queued for a question already outstanding');
 for (const candidate of report.candidates.filter(item => item.lane === 'RESERVE')) {
  assert.ok(candidate.release, 'a held candidate records what would release it');
 }
});

// 8. The mistake that would have read a ticket robot as a person who answered.
test('an automated acknowledgement never becomes a human reply, or a free pass', async () => {
 const contacts = await store([
  contact('auto-ack-shape', {github_logins: ['example-tracker-org']}, [
   sent, {type: 'INBOUND_REPLY', at: '2026-09-01T09:00:30Z', human: false}
  ])
 ]);
 const record = contacts.contacts[0].contact;
 assert.equal(record.conversation.human_reply, false, 'a robot is not a person');
 assert.equal(record.conversation.last_inbound_at, null);
 assert.equal(record.conversation.last_auto_inbound_at, '2026-09-01T09:00:30Z');
 assert.equal(record.conversation.conversation_status, 'AWAITING_REPLY');

 const verdict = resolvePosture(contacts, undefined, ['x'], {id: 'x', owner: 'example-tracker-org'});
 assert.equal(verdict.posture, 'AWAITING_REPLY', 'a receipt does not release the wait');
 assert.notEqual(verdict.posture, 'NEVER_CONTACTED');

 // And through the whole pipeline: south-harbor-games is the auto-ack shape.
 const report = byId(await discover(workspace, {contacts: await indexedStore(), metadata: await undeclared()}));
 assert.equal(report['kagerou-south-port'].contact.posture, 'AWAITING_REPLY');
 assert.equal(report['kagerou-south-port'].verdict, 'IGNORE');
});

// ---------------------------------------------------------------------------------------
// 9. Similarity, which is never identity in either direction.
// ---------------------------------------------------------------------------------------

test('a similar name raises a hand and never merges two parties', async () => {
 const contacts = await store([
  contact('kagerou-thread-shape', {github_logins: ['kagerou-north']}, [sent]),
  contact('sibling-repo-shape', {repositories: ['some-other-owner/harbour-chronicle']}, [sent])
 ]);

 // A login that contains another login is a hand raised, not a match.
 const fragment = resolvePosture(contacts, undefined, ['x'], {id: 'x', owner: 'kagerou-north-games'});
 assert.equal(fragment.posture, 'AMBIGUOUS_MATCH');
 assert.equal(fragment.matchState, 'AMBIGUOUS');
 assert.deepEqual(fragment.contactIds, []);
 assert.ok(fragment.nearMatches.some(hit => hit.kinds.includes('login_fragment')));

 // The same repository name under a different owner is a different repository.
 const bareName = resolvePosture(contacts, undefined, ['x'], {
  id: 'x', owner: 'unrelated-owner', repository: 'unrelated-owner/harbour-chronicle'
 });
 assert.equal(bareName.posture, 'AMBIGUOUS_MATCH');
 assert.ok(bareName.nearMatches.some(hit => hit.kinds.includes('repository_name')));

 // A shared uncommon word between names is a hand raised.
 const token = resolvePosture(contacts, undefined, ['kagerou-southern-port'], {id: 'kagerou-southern-port', owner: 'unrelated-owner'});
 assert.equal(token.posture, 'AMBIGUOUS_MATCH');

 // None of these ever produces a contact id, because none of them concluded anything.
 for (const verdict of [fragment, bareName, token]) {
  assert.deepEqual(verdict.contactIds, []);
  assert.equal(verdict.conclusion, 'INCONCLUSIVE');
 }
});

test('a shared first name, organization or project category is not identity evidence', async () => {
 const contacts = await store([
  {id: 'vendor-thread-shape', name: 'Prospect V', organization: 'Example localization studio',
   channel: 'GMAIL', identity: {github_logins: ['example-handle-v']}, events: [sent]}
 ]);
 // Same kind of work, same kind of organization, different party: category words are
 // stopwords, so nothing here raises a hand and nothing here matches.
 const verdict = resolvePosture(contacts, undefined, ['japanese-localization-tools'], {
  id: 'japanese-localization-tools', owner: 'unrelated-owner', aliases: ['Japanese localization studio tools']
 });
 assert.equal(verdict.posture, 'NEVER_CONTACTED');
 assert.deepEqual(verdict.matchEvidence, []);
 assert.deepEqual(nearMatches(['Japanese localization studio tools'], contacts), []);

 // An alias made only of category words cannot match a contact alias either.
 const generic = await store([contact('generic-shape', {aliases: ['Game Project']}, [sent])]);
 const identity = prospectIdentity({id: 'x', aliases: ['game project']});
 assert.deepEqual(identity.exactAliases, [], 'an alias with no distinctive token is a category, not a name');
 assert.equal(isIdentifiable(identity), false);
 assert.equal(matchProspect(buildIndex(generic), identity).state, 'UNIDENTIFIABLE');
});

// ---------------------------------------------------------------------------------------
// 10-12. Every way a store can fail, and the one thing they all do.
// ---------------------------------------------------------------------------------------

// 10. Malformed input is refused outright. It never degrades into an empty store, which
// would read as "checked, nobody is in there".
test('a malformed store is refused rather than read as an empty one', async () => {
 const bad = [
  '{',
  '[]',
  '{}',
  '{"schema":"something-else","contacts":[]}',
  '{"contacts":{}}',
  '{"contacts":[{"id":"a","events":[],"conversation":{}}]}',
  '{"contacts":[{"id":"a","identity":{"github_logins":["not a login"]}}]}',
  '{"contacts":[{"id":"a","identity":{"repositories":["no-owner"]}}]}',
  '{"contacts":[{"id":"a","identity":{"emails":["not-an-address"]}}]}',
  '{"contacts":[{"id":"a","identity":{"domains":["not a host"]}}]}',
  '{"contacts":[{"id":"a","identity":{"nope":["x"]}}]}',
  '{"contacts":[{"id":"a","identity":{"github_logins":"not-an-array"}}]}',
  '{"contacts":[{"id":"a","identity":{"aliases":["  "]}}]}'
 ];
 for (const text of bad) assert.throws(() => readContactStore(text, 'bad'), ContactStateError, text.slice(0, 50));

 const dir = await mkdtemp(path.join(os.tmpdir(), 'yn0-store-'));
 try {
  const file = path.join(dir, 'broken.json');
  await writeFile(file, '{"contacts":[');
  await assert.rejects(() => loadContactStoreFile(file), /not valid JSON/);

  // The CLI stops. It does not run the review with no store and it does not run it with
  // an empty one - both would report candidates as never contacted.
  const cli = await run(process.execPath, [
   path.join(scannerDir, 'review.mjs'), workspace, '--contacts', file
  ], {cwd: repoRoot}).then(() => ({code: 0}), error => error);
  assert.equal(cli.code, 1);
  assert.match(cli.stderr, /review failed/);
  assert.equal((cli.stdout ?? '').includes('NEVER_CONTACTED'), false);
 } finally {
  await rm(dir, {recursive: true, force: true});
 }
});

// 11. A store that is not there is not a store with nobody in it.
test('a store that cannot be read fails closed instead of defaulting', async () => {
 await assert.rejects(() => loadContactStoreFile(path.join(fixtures, 'no-such-store.json')), /could not be read/);

 const cli = await run(process.execPath, [
  path.join(scannerDir, 'prospect.mjs'), workspace, '--contacts', path.join(fixtures, 'no-such-store.json')
 ], {cwd: repoRoot}).then(() => ({code: 0}), error => error);
 assert.equal(cli.code, 1);
 assert.equal((cli.stdout ?? '').includes('READY_FOR_REVIEW'), false);

 // No caller anywhere may turn a failed load into "no store" or into an empty store.
 for (const name of ['prospect.mjs', 'review.mjs']) {
  const text = await readFile(path.join(scannerDir, name), 'utf8');
  assert.match(text, /options\.contacts \? await loadContactStoreFile\(options\.contacts\) : null/, name);
  assert.equal(/catch[\s\S]{0,120}contacts\s*=/.test(text), false, name + ' must not swallow a store failure');
  assert.equal(/contacts\s*\?\?\s*\{/.test(text), false, name + ' must not default a store to an empty object');
 }
});

// 12. Two rows for one id is two answers to "what state is this contact in?".
test('a store that repeats a contact id is refused', async () => {
 assert.throws(() => readContactStore(JSON.stringify({
  contacts: [{id: 'same-shape', events: []}, {id: 'same-shape', events: []}]
 }), 'dup'), /repeats contact id same-shape/);

 // Repeating an identifier across two contacts is *not* an error: one party on two
 // channels is two records by design, and both of them are returned.
 const twoChannels = await store([
  contact('one-shape', {github_logins: ['example-handle-a']}, [sent]),
  contact('two-shape', {github_logins: ['example-handle-a']}, [sent])
 ]);
 assert.deepEqual(matchProspect(buildIndex(twoChannels), prospectIdentity({id: 'x', owner: 'example-handle-a'})).contactIds,
  ['one-shape', 'two-shape']);
});

// ---------------------------------------------------------------------------------------
// 13. Disagreement between a human's claim and the store's own identifiers.
// ---------------------------------------------------------------------------------------

test('conflicting identity evidence fails closed rather than picking a side', async () => {
 const contacts = await store([
  contact('closed-shape', {github_logins: ['example-handle-a']}, [
   sent, {type: 'INBOUND_REPLY', at: '2026-09-02T09:00:00Z'},
   {type: 'CONVERSATION_ENDED', at: '2026-09-03T09:00:00Z', direction: 'outbound'}
  ]),
  contact('other-shape', {github_logins: ['example-handle-b']}, [sent])
 ]);
 const candidate = {id: 'x', owner: 'example-handle-a'};

 // The most dangerous disagreement there is: a human wrote down "never contacted" about
 // somebody the store can recognize. It is never resolved in favour of the human.
 const declaredNone = resolvePosture(contacts, [], ['x'], candidate);
 assert.equal(declaredNone.posture, 'AMBIGUOUS_MATCH');
 assert.equal(declaredNone.conclusion, 'INCONCLUSIVE');
 assert.match(declaredNone.reason, /declared as never contacted, but/);
 assert.match(declaredNone.reason, /closed-shape/);

 // Declared as one contact, recognized as another.
 const declaredWrong = resolvePosture(contacts, ['other-shape'], ['x'], candidate);
 assert.equal(declaredWrong.posture, 'AMBIGUOUS_MATCH');
 assert.match(declaredWrong.reason, /closed-shape/);

 // Agreement is not a conflict: the declaration stands and the posture is the contact's.
 const agreed = resolvePosture(contacts, ['closed-shape'], ['x'], candidate);
 assert.equal(agreed.posture, 'INBOUND_ONLY');
 assert.equal(agreed.linkSource, 'DECLARED');

 // A declared id the store does not have is unresolved, never "nobody".
 assert.equal(resolvePosture(contacts, ['no-such-shape'], ['x'], candidate).posture, 'UNRESOLVED');
});

// ---------------------------------------------------------------------------------------
// 14. Nothing real is in the repository.
// ---------------------------------------------------------------------------------------

test('no real contact data reaches a tracked file, and the ignore rules still cover it', async () => {
 for (const dir of [path.join(repoRoot, 'internal', 'contact-state'), scannerDir]) {
  const ignore = await readFile(path.join(dir, '.gitignore'), 'utf8');
  const rules = ignore.split('\n').map(line => line.trim());
  for (const rule of ['*.local.json', '*.local.md']) {
   assert.ok(rules.includes(rule), path.basename(dir) + '/.gitignore must ignore ' + rule);
  }
 }

 const tracked = [];
 const collect = async dir => {
  for (const item of (await readdir(dir, {withFileTypes: true})).sort((a, b) => (a.name < b.name ? -1 : 1))) {
   if (item.name.includes('.local.')) continue;
   const next = path.join(dir, item.name);
   if (item.isDirectory()) await collect(next);
   else tracked.push([path.relative(repoRoot, next), await readFile(next, 'utf8')]);
  }
 };
 await collect(path.join(repoRoot, 'internal', 'contact-state'));
 await collect(fixtures);
 assert.ok(tracked.length > 20);
 for (const [name, text] of tracked) {
  assert.equal(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text), false, name + ' carries something shaped like an address');
  for (const url of text.match(/https?:\/\/[^\s"'\\)]+/g) ?? []) {
   assert.match(url, /^https:\/\/(example\.invalid|api\.github\.com)/, name + ' cites ' + url);
  }
 }

 // Fixtures are the strict case above; the rest of this tree may name a host or write an
 // address only when it has to, and then only a reserved one. The two exceptions are the
 // hosts the matcher and the client exist to talk about, and they are named here so a
 // third one cannot be added quietly.
 const everything = [];
 const sweep = async dir => {
  for (const item of (await readdir(dir, {withFileTypes: true})).sort((a, b) => (a.name < b.name ? -1 : 1))) {
   if (item.name.includes('.local')) continue;
   const next = path.join(dir, item.name);
   if (item.isDirectory()) await sweep(next);
   else everything.push([path.relative(repoRoot, next), await readFile(next, 'utf8')]);
  }
 };
 await sweep(scannerDir);
 assert.ok(everything.length > 40);
 for (const [name, text] of everything) {
  for (const address of text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) ?? []) {
   assert.match(address, /\.(example|invalid)$/i, name + ' writes ' + address + '; only a reserved domain may appear');
  }
  for (const url of text.match(/https?:\/\/[^\s"'\\)]+/g) ?? []) {
   assert.match(url, /^https:\/\/([\w.-]*\.)?(example\.invalid|example|invalid|github\.com)(\/|$)/i,
    name + ' cites ' + url + '; only a reserved host, github.com or api.github.com may appear');
  }
  assert.equal(/gh[pousr]_[A-Za-z0-9]{16,}/.test(text), false, name + ' must not carry a literal token');
 }

 // Every identifier in every tracked store is a placeholder, including the new identity
 // blocks: a real handle in a fixture would make the fixture read as a real contact.
 for (const file of ['v3-contacts.json', 'v3-contacts-indexed.json', 'v3-contacts-payer-open.json', 'contacts.json']) {
  const loaded = readContactStore(await load(file), file);
  for (const {contact: record} of loaded.contacts) {
   assert.match(record.id, /-shape$/, file + ': ' + record.id + ' must name a conversation shape');
   assert.match(record.name, /^Prospect [A-Z]$/, file + ': ' + record.id);
   assert.match(record.organization, /^Example /, file + ': ' + record.id);
   assert.equal(record.channel_ref, null, file + ': ' + record.id + ' must not cite a real thread');
   for (const key of identityKeys(record)) {
    assert.match(key, /^(github_login|repository|alias|email|domain|manual_link):/, key);
    assert.match(key, /(example|prospect|shape|harbor|harbour|kagerou|north|south|alpha|optout|volunteer|circle|tracker|studio|chronicle)/i,
     file + ': ' + key + ' must be an obvious placeholder');
   }
  }
 }

 // And no identifier crosses the boundary into a report: what travels is a kind and an id.
 const contacts = await indexedStore();
 const text = JSON.stringify(await review(workspace, {manifest: await manifest(), contacts}));
 for (const {contact: record} of contacts.contacts) {
  assert.equal(text.includes(record.name), false, record.name + ' leaked into the report');
  assert.equal(text.includes(record.organization), false, record.organization + ' leaked into the report');
  for (const alias of record.identity.aliases) assert.equal(text.includes(alias), false, alias + ' leaked into the report');
 }
});

// ---------------------------------------------------------------------------------------
// The two preconditions for saying "not in the store", which are easy to lose and
// expensive to lose quietly.
// ---------------------------------------------------------------------------------------

// A contact nothing can recognize cannot be excluded, so nobody can be called a stranger.
test('one contact without identity evidence makes every lookup inconclusive', async () => {
 const coverage = identityCoverage(await opaqueStore());
 assert.equal(coverage.complete, false);
 assert.ok(coverage.opaqueCount > 0);

 const partial = await store([
  contact('indexed-shape', {github_logins: ['example-handle-a']}, [sent]),
  {id: 'opaque-shape', name: 'Prospect Y', organization: 'Example test shape', channel: 'OTHER', events: [sent]}
 ]);
 const verdict = resolvePosture(partial, undefined, ['x'], {id: 'x', owner: 'example-unrelated-org'});
 assert.equal(verdict.posture, 'UNCHECKED');
 assert.equal(verdict.matchState, 'STORE_NOT_INDEXED');
 assert.match(verdict.reason, /opaque-shape/);

 // Index that contact and the same lookup becomes an answer.
 const full = await store([
  contact('indexed-shape', {github_logins: ['example-handle-a']}, [sent]),
  contact('opaque-shape', {github_logins: ['example-handle-y']}, [sent])
 ]);
 assert.equal(resolvePosture(full, undefined, ['x'], {id: 'x', owner: 'example-unrelated-org'}).posture, 'NEVER_CONTACTED');

 // A store with nobody in it is indistinguishable from the wrong file, and proves nothing.
 const empty = await store([]);
 assert.equal(resolvePosture(empty, undefined, ['x'], {id: 'x', owner: 'example-unrelated-org'}).posture, 'UNCHECKED');
});

// A candidate the store could not have been asked about was not checked.
test('a candidate with no public identity is unchecked, never a stranger', async () => {
 const contacts = await indexedStore();
 const verdict = resolvePosture(contacts, undefined, ['some-directory'], {id: 'some-directory'});
 assert.equal(verdict.posture, 'UNCHECKED');
 assert.equal(verdict.matchState, 'UNIDENTIFIABLE');
 assert.match(verdict.reason, /no identifier/);

 // The candidate id is a name discovery invented. It may carry a manual link a human
 // wrote down, but on its own it is not an identity the store can be searched by.
 assert.equal(isIdentifiable(prospectIdentity({id: 'some-directory'})), false);
 assert.equal(isIdentifiable(prospectIdentity({id: 'x', owner: 'example-org'})), true);

 // v2 without a manifest knows only directory names, so it stays UNCHECKED throughout -
 // which is correct, and is why the manifest carries owner, repository and url.
 const report = await discover(workspace, {contacts});
 for (const prospect of report.prospects) {
  assert.equal(prospect.contact.posture, 'UNCHECKED');
  assert.notEqual(prospect.verdict, 'READY_FOR_REVIEW');
 }
});

// ---------------------------------------------------------------------------------------
// The schema and the vocabulary.
// ---------------------------------------------------------------------------------------

test('identity evidence is validated, normalized and never invented', () => {
 const identity = normalizeIdentity({
  github_logins: ['@Example-Handle-A', 'example-handle-a'],
  repositories: ['Example-Handle-A/Prospect-A-Project.git'],
  aliases: ['  Prospect   A   Project  '],
  domains: ['https://Prospect-A.Example/path'],
  manual_links: ['Some-Candidate-Id']
 });
 assert.deepEqual(identity.github_logins, ['example-handle-a'], 'case and @ are folded, duplicates collapse');
 assert.deepEqual(identity.repositories, ['example-handle-a/prospect-a-project']);
 assert.deepEqual(identity.aliases, ['prospect a project']);
 assert.deepEqual(identity.domains, ['prospect-a.example'], 'a pasted homepage is reduced to the host it names');
 assert.deepEqual(identity.manual_links, ['some-candidate-id']);
 assert.deepEqual(identity.emails, [], 'an absent field is empty, never guessed');

 // Full-width and half-width spellings of one name are one name.
 assert.equal(normalizeAlias('ＰＲＯＳＰＥＣＴ　Ａ'), normalizeAlias('prospect a'));
 assert.equal(normalizeAlias('日本語プロジェクト'), '日本語プロジェクト');

 for (const bad of [{github_logins: ['has a space']}, {repositories: ['bare-name']},
  {domains: ['not a host']}, {emails: ['nope']}, {manual_links: ['Has A Space']},
  {github_logins: [42]}, {aliases: ['']}, {unknown_field: []}]) {
  assert.throws(() => normalizeIdentity(bad, 'identity'), ContactStateError, JSON.stringify(bad));
 }

 assert.deepEqual(identityKeys({identity}), [
  'alias:prospect a project',
  'domain:prospect-a.example',
  'github_login:example-handle-a',
  'manual_link:some-candidate-id',
  'repository:example-handle-a/prospect-a-project'
 ]);
 assert.deepEqual(identityKeys({}), [], 'a contact with no identity block is opaque');
});

test('the report can always tell a checked stranger from an unchecked one', async () => {
 const report = await review(workspace, {manifest: await manifest(), contacts: await indexedStore()});
 assert.equal(report.contactStore.identityCoverage.complete, true);
 for (const candidate of report.candidates) {
  assert.ok(CONCLUSIONS.includes(candidate.v2.contactConclusion), candidate.id);
  assert.ok(POSTURES.includes(candidate.v2.contactPosture), candidate.id);
  // The one invariant that matters: a posture of NEVER_CONTACTED always comes with a
  // conclusion that somebody - a human or the matcher - actually reached.
  if (candidate.v2.contactPosture === 'NEVER_CONTACTED') {
   assert.equal(candidate.v2.contactConclusion, 'NO_MATCH', candidate.id);
  }
  if (candidate.v2.contactConclusion === 'NOT_CONSULTED') {
   assert.notEqual(candidate.v2.contactPosture, 'NEVER_CONTACTED', candidate.id);
  }
 }

 // A metadata file can carry the identity too, so v2 works on its own with no manifest.
 const metadata = loadMetadata(JSON.stringify({
  schema: 'yn0-prospect-metadata-v1',
  prospects: {'ready-candidate': {activity: 'ACTIVE', public_contact_route: 'GITHUB_ISSUE', owner: 'example-ready-org'}}
 }));
 const v2 = byId(await discover(path.join(fixtures, 'workspace'), {contacts: await indexedStore(), metadata}));
 assert.equal(v2['ready-candidate'].contact.posture, 'NEVER_CONTACTED');
 assert.equal(v2['ready-candidate'].contact.conclusion, 'NO_MATCH');
 assert.equal(v2['ready-candidate'].verdict, 'READY_FOR_REVIEW');
});
