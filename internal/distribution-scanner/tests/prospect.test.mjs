// Tests for the YN0 Prospect Discovery layer. Run with:
//   node --test internal/distribution-scanner/tests/prospect.test.mjs
//
// The fixtures under ../prospect-fixtures are invented. Every candidate directory is
// named after the *shape* it exercises, every contact id ends in `-shape`, and a test
// below fails if a real name, address or contact status ever lands in a tracked file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RULES, ADVISORY_RULES, BLANK_RULES} from '../lib/checks.mjs';
import {CONFIDENCE_BANDS, RULE_CONFIDENCE, UNBANDED_RULES, bandCounts, bandOf, noiseRatio} from '../lib/confidence.mjs';
import {LOCALE_FORMATS, classifyAsset, classifyPaths, inventory, languageTag, summarize} from '../lib/assets.mjs';
import {DEFAULT_PROSPECT_THRESHOLDS, VERDICTS, aggregate, decide} from '../lib/candidates.mjs';
import {POSTURES, nearMatches, outstandingAxes, readContactStore, resolvePosture} from '../lib/contact-link.mjs';
import {ProspectMetadataError, emptyEntry, loadMetadata} from '../lib/metadata.mjs';
import {SCHEMA, discover, renderText} from '../lib/prospects.mjs';
import {walk} from '../lib/discover.mjs';
import {parseArgs} from '../prospect.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '..', 'prospect-fixtures');
const workspace = path.join(fixtures, 'workspace');
const scannerDir = path.join(here, '..');

const loadFixtures = async () => ({
 contacts: readContactStore(await readFile(path.join(fixtures, 'contacts.json'), 'utf8'), 'fixture store'),
 metadata: loadMetadata(await readFile(path.join(fixtures, 'metadata.json'), 'utf8'), 'fixture metadata')
});

const run = async (extra = {}) => discover(workspace, {...(await loadFixtures()), ...extra});
const byId = report => Object.fromEntries(report.prospects.map(prospect => [prospect.id, prospect]));

// The whole rule table, pinned. Each row is one shape the engine has to get right.
test('every candidate fixture lands on its documented verdict and rule', async () => {
 const prospects = byId(await run());
 const expected = {
  'opted-out':               ['IGNORE', 1],
  'closed-conversation':     ['IGNORE', 2],
  'already-contacted':       ['IGNORE', 3],
  'unknown-contact-id':      ['HUMAN_REVIEW', 4],
  'ambiguous-identity':      ['HUMAN_REVIEW', 4],
  'dormant-repo':            ['IGNORE', 5],
  'no-public-route':         ['IGNORE', 6],
  'no-locale-assets':        ['IGNORE', 7],
  'unsupported-format-repo': ['HUMAN_REVIEW', 8],
  'english-side-repo':       ['IGNORE', 9],
  'incomplete-locale':       ['IGNORE', 10],
  'clean-repo':              ['IGNORE', 11],
  'intentional-risk-repo':   ['HUMAN_REVIEW', 12],
  'noise-dominated':         ['IGNORE', 13],
  'undeclared-contact-link': ['HUMAN_REVIEW', 14],
  'unknown-activity':        ['HUMAN_REVIEW', 15],
  'ready-candidate':         ['READY_FOR_REVIEW', 17],
  'mixed-format-candidate':  ['READY_FOR_REVIEW', 17]
 };
 assert.deepEqual(Object.keys(prospects).sort(), Object.keys(expected).sort());
 for (const [id, [verdict, rule]] of Object.entries(expected)) {
  assert.deepEqual([prospects[id].verdict, prospects[id].rule], [verdict, rule], id);
  assert.ok(prospects[id].reason.length > 0, id + ' must say why');
 }
 // The point of the exercise: most candidates are dropped before a human sees them.
 const report = await run();
 assert.deepEqual(report.summary, {READY_FOR_REVIEW: 2, HUMAN_REVIEW: 6, IGNORE: 10});
 assert.equal(report.schema, SCHEMA);
});

// A repository whose only Japanese lives in a PO file is not a repository without
// Japanese. Reporting it as "no localization" would throw away a real candidate.
test('an unsupported localization format is detected, not mistaken for an absence', async () => {
 const prospect = byId(await run())['unsupported-format-repo'];
 assert.equal(prospect.assets.assetCount, 2);
 assert.deepEqual(prospect.assets.supportedFormats, []);
 assert.deepEqual(prospect.assets.unsupportedFormats, ['po']);
 assert.deepEqual(prospect.assets.englishJapaneseFormats, ['po'], 'both sides of the pair were seen');
 assert.deepEqual([prospect.assets.hasEnglish, prospect.assets.hasJapanese], [true, true]);
 assert.equal(prospect.evidence.pairCount, 0, 'nothing was parsed');
 assert.equal(prospect.verdict, 'HUMAN_REVIEW');
 assert.match(prospect.reason, /DETECTED_BUT_UNSUPPORTED/);

 // Detecting a format is not a step towards parsing it: the format carries no adapter,
 // and the report says so rather than quietly promising support.
 assert.deepEqual(prospect.assets.formats.map(item => [item.format, item.support]), [['po', 'DETECTED_BUT_UNSUPPORTED']]);

 // And an unsupported format alongside a readable pair is extra information, not a blocker.
 const mixed = byId(await run())['mixed-format-candidate'];
 assert.deepEqual(mixed.assets.supportedFormats, ['json']);
 assert.deepEqual(mixed.assets.unsupportedFormats, ['csv', 'po']);
 assert.equal(mixed.verdict, 'READY_FOR_REVIEW');
});

test('asset classification needs locale evidence in the path, not just an extension', () => {
 const cases = [
  ['locales/ja.json', {format: 'json', support: 'SUPPORTED', language: 'ja'}],
  ['translations/strings-ja.json', {format: 'json', support: 'SUPPORTED', language: 'ja'}],
  ['i18n/de/common.yaml', {format: 'yaml', support: 'DETECTED_BUT_UNSUPPORTED', language: 'de'}],
  ['locale/messages.po', {format: 'po', support: 'DETECTED_BUT_UNSUPPORTED', language: null}],
  ['locales/glossary.csv', {format: 'csv', support: 'DETECTED_BUT_UNSUPPORTED', language: null}],
  ['app/Base.lproj/Localizable.strings', {format: 'strings', support: 'DETECTED_BUT_UNSUPPORTED', language: null}]
 ];
 for (const [relPath, expected] of cases) {
  const hit = classifyAsset(relPath);
  assert.deepEqual({format: hit.format, support: hit.support, language: hit.language}, expected, relPath);
 }
 // No part of these paths says "locale", so none of them is a localization asset.
 for (const relPath of ['package.json', 'data/items.json', 'src/it/Main.xml', 'README.md', 'config/no/settings.yaml']) {
  assert.equal(classifyAsset(relPath), null, relPath);
 }
 // A tag-shaped token whose base subtag is not a language is not a language tag.
 assert.deepEqual(languageTag('ja_JP'), {lang: 'ja', region: 'jp'});
 assert.equal(languageTag('src'), null);
 assert.equal(languageTag('lib'), null);

 // Every extension the inventory knows is either claimed by an adapter or explicitly unsupported.
 for (const ext of Object.keys(LOCALE_FORMATS)) {
  const hit = classifyAsset('locales/ja' + ext);
  assert.ok(hit, ext);
  assert.ok(['SUPPORTED', 'DETECTED_BUT_UNSUPPORTED'].includes(hit.support), ext);
 }
 assert.deepEqual(summarize([]).formats, []);
});

// Calibration bug A-1. A language tag that falls out of a longer filename is not evidence
// of anything by itself: these three are real paths from a real exploration run, and all
// three were being inventoried as localization assets in a language nobody had written.
test('a language tag carved out of a longer filename needs locale context to count', () => {
 const falsePositives = [
  ['.github/workflows/nightly-windows-ms.yml', 'ms', 'Malay'],
  ['.github/workflows/oh-my-dsh.yml', 'my', 'Burmese'],
  ['.github/workflows/Mr-potato-123__dsh-mcp.yml', 'mr', 'Marathi'],
  // The same names outside .github, so this is the filename rule being tested and not
  // the skipped-directory rule that also covers those three paths.
  ['ci/nightly-windows-ms.yml', 'ms', 'Malay'],
  ['scripts/oh-my-dsh.yml', 'my', 'Burmese'],
  ['build/config/Mr-potato-123__dsh-mcp.yml', 'mr', 'Marathi'],
  ['tools/release-is.json', 'is', 'Icelandic'],
  ['data/level-da.csv', 'da', 'Danish'],
  // Two more from the same run: a plugin catalogue whose entries are named after their
  // authors, and a character-encoding table.
  ['data/plugins/Mr-Neutr0n__dsh-medseek.yml', 'mr', 'Marathi'],
  ['conf/char_encoding_tbl_eu.txt', 'eu', 'Basque']
 ];
 for (const [relPath, tag, language] of falsePositives) {
  assert.equal(classifyAsset(relPath), null, relPath + ' is not ' + language + ' because it ends in "' + tag + '"');
 }

 // ... and the conventions that are evidence still are. Each row names the thing in the
 // path that makes the tag mean something.
 const keeps = [
  ['locales/en-US-strings.json', 'en', 'a locale directory'],
  ['src/ui/strings-ja.json', 'ja', 'a stem that names translations'],
  ['config/messages_de.properties', 'de', 'a stem that names translations'],
  ['ja.json', 'ja', 'the whole basename is the tag'],
  ['assets/data/ja_JP.csv', 'ja', 'the whole basename is the tag'],
  ['po/oh-my-dsh.po', 'my', 'an extension that exists only for localization'],
  // Real paths from the same run, on the other side of the line. The locale word is a
  // token inside a longer name rather than the whole of one, which is how real trees are
  // written - a whole-segment match would throw all four of these away.
  ['data/relic_translations_ja.json', 'ja', 'a locale word inside the stem'],
  ['assets/builtin-dict-ja.json', 'ja', 'a locale word inside the stem'],
  ['glossaries/bloodborne-ja-zh.json', 'ja', 'a locale word in a directory'],
  ['samples/03-ui-strings_en-ja/source.en.json', 'en', 'a locale word in a directory'],
  ['_Inkitmod/chnlocalplus/localisation/replace/de_sections_l_english.yml', 'de', 'a locale directory']
 ];
 for (const [relPath, language, because] of keeps) {
  const hit = classifyAsset(relPath);
  assert.ok(hit, relPath + ' is a localization asset: ' + because);
  assert.equal(hit.language, language, relPath);
 }
});

// Calibration bug A-2. `walk()` prunes .git, .github, node_modules, dist and the rest as
// it descends; the remote explorer gets a flat list and cannot prune anything, so both
// sides go through one function and agree by construction.
test('the asset inventory skips the same directories however the paths were obtained', () => {
 const tree = [
  'locales/en.json',
  'locales/ja.json',
  '.github/workflows/i18n-ja.yml',
  'node_modules/some-package/locales/ja.json',
  'dist/locales/ja.json',
  'vendor/lib/i18n/ja.json',
  'build/i18n/ja.json',
  'src/index.js'
 ];
 assert.deepEqual(classifyPaths(tree).map(asset => asset.path), ['locales/en.json', 'locales/ja.json'],
  'a vendored or built copy of somebody else\'s locale file is not this project\'s localization');
 // The rule is about the directories above the file, not about the file's own name.
 assert.deepEqual(classifyPaths(['dist.json', 'i18n/node_modules.json']).map(asset => asset.path),
  ['i18n/node_modules.json']);
});

// The engine's whole reason for existing: drop the weak candidate before a human reads it.
test('an incomplete or noise-dominated locale is never a strong prospect', async () => {
 const prospects = byId(await run());

 const incomplete = prospects['incomplete-locale'];
 assert.equal(incomplete.verdict, 'IGNORE');
 assert.equal(incomplete.evidence.localeCompleteness, 0.5);
 assert.equal(incomplete.evidence.highConfidenceFindings, 1,
  'the fixture only guards the rule while a real finding is present under the incompleteness');
 assert.match(incomplete.reason, /unfinished, not defective/);

 const noisy = prospects['noise-dominated'];
 assert.equal(noisy.verdict, 'IGNORE');
 assert.equal(noisy.evidence.highConfidenceFindings, 1);
 assert.equal(noisy.evidence.intentionalRiskFindings, 20);
 assert.match(noisy.reason, /the signal is buried/);

 // Both are judgements, not laws: the thresholds that produced them are inputs.
 const lenient = byId(await run({thresholds: {minCompleteness: 0.4, maxNoiseRatio: 0.99}}));
 assert.equal(lenient['incomplete-locale'].verdict, 'READY_FOR_REVIEW');
 assert.equal(lenient['noise-dominated'].verdict, 'READY_FOR_REVIEW');
});

// Atlos: a finding a maintainer can wave away as intentional cannot carry a first contact.
test('findings that may be intentional never reach READY_FOR_REVIEW on their own', async () => {
 const prospect = byId(await run())['intentional-risk-repo'];
 assert.equal(prospect.verdict, 'HUMAN_REVIEW');
 assert.equal(prospect.evidence.highConfidenceFindings, 0);
 assert.equal(prospect.evidence.intentionalRiskFindings, 3);
 assert.deepEqual(Object.keys(prospect.evidence.findingsByRule).sort(),
  ['edge-whitespace', 'fullwidth-space', 'placeholder-multiplicity-mismatch']);
 assert.ok(prospect.samples.length, 'a HUMAN_REVIEW row still shows what was found');

 // Even a hundred of them stay short of a contact: only the band decides.
 const facts = {
  contact: {posture: 'NEVER_CONTACTED', reason: 'x', contactIds: [], nearMatches: []},
  metadata: {...emptyEntry(), activity: 'ACTIVE', public_contact_route: 'GITHUB_ISSUE'},
  assets: {assetCount: 2, unsupportedFormats: []},
  evidence: {pairCount: 1, enKeyCount: 100, untranslatedKeys: 0, localeCompleteness: 1,
   highConfidenceFindings: 0, intentionalRiskFindings: 100, incompleteLocaleFindings: 0, noiseRatio: 1},
  asking: null,
  outstandingAxes: []
 };
 assert.deepEqual(decide(facts, DEFAULT_PROSPECT_THRESHOLDS).verdict, 'HUMAN_REVIEW');
});

// Prospect Burn. No contact-state answer other than "checked, nothing there" may produce
// a candidate a human is asked to act on.
test('no contact posture but NEVER_CONTACTED can reach READY_FOR_REVIEW', () => {
 const strongest = posture => ({
  contact: {posture, reason: 'fixture', contactIds: [], nearMatches: []},
  metadata: {...emptyEntry(), activity: 'ACTIVE', public_contact_route: 'GITHUB_ISSUE'},
  assets: {assetCount: 2, unsupportedFormats: []},
  evidence: {pairCount: 1, enKeyCount: 100, untranslatedKeys: 0, localeCompleteness: 1,
   highConfidenceFindings: 40, intentionalRiskFindings: 0, incompleteLocaleFindings: 0, noiseRatio: 0},
  asking: null,
  outstandingAxes: []
 });
 for (const posture of POSTURES) {
  const {verdict} = decide(strongest(posture), DEFAULT_PROSPECT_THRESHOLDS);
  assert.equal(verdict === 'READY_FOR_REVIEW', posture === 'NEVER_CONTACTED',
   posture + ' produced ' + verdict + ' on the strongest possible evidence');
  assert.ok(VERDICTS.includes(verdict), posture);
 }
});

test('contact postures are folded from contact-state rather than re-decided here', async () => {
 const {contacts} = await loadFixtures();
 const posture = ids => resolvePosture(contacts, ids, []).posture;
 assert.equal(posture(['opted-out-shape']), 'DO_NOT_CONTACT');
 assert.equal(posture(['closed-thread-shape']), 'INBOUND_ONLY');
 assert.equal(posture(['awaiting-first-reply-shape']), 'AWAITING_REPLY');
 assert.equal(posture(['payer-question-open-shape']), 'AWAITING_REPLY');
 assert.equal(posture([]), 'NEVER_CONTACTED');
 assert.equal(posture(['no-such-contact-shape']), 'UNRESOLVED');

 // The most restrictive answer wins when a prospect resolves to several threads.
 assert.equal(posture(['awaiting-first-reply-shape', 'opted-out-shape']), 'DO_NOT_CONTACT');

 // Absence of evidence is not evidence of absence.
 assert.equal(resolvePosture(null, [], []).posture, 'UNCHECKED');
 assert.equal(resolvePosture(contacts, undefined, []).posture, 'UNCHECKED');

 // A name that looks like somebody already in the store raises a hand rather than passing.
 assert.equal(resolvePosture(contacts, [], ['Localization vendor toolkit']).posture, 'AMBIGUOUS_MATCH');
 assert.deepEqual(nearMatches(['Localization vendor toolkit'], contacts).map(hit => hit.id), ['vendor-thread-shape']);
 assert.deepEqual(nearMatches(['ready-candidate'], contacts), [], 'common words are not identity evidence');
});

// Waiting on an answer from one party is a reason not to ask *that party* again. It is
// not a reason to hold anybody else: a second, independently checked party answering the
// same question is an independent sample, and that is what the axis is short of.
test('an outstanding answer is scoped to the party that owes it', async () => {
 const {contacts} = await loadFixtures();

 // Store-wide: a reporting figure, and that is all it is.
 assert.deepEqual(outstandingAxes(contacts), ['payer']);

 // The party that owes the answer carries it on its own record...
 const owes = resolvePosture(contacts, ['payer-question-open-shape'], []);
 assert.equal(owes.posture, 'AWAITING_REPLY');
 assert.deepEqual(owes.outstandingAxes, ['payer']);

 // ...and a party the store was consulted about and did not hold owes nothing.
 const stranger = resolvePosture(contacts, [], []);
 assert.equal(stranger.posture, 'NEVER_CONTACTED');
 assert.deepEqual(stranger.outstandingAxes, []);

 // Through the pipeline, asking the very question that is outstanding elsewhere:
 // ready-candidate is a different party and is not held by somebody else's silence.
 const asked = byId(await run({asking: 'payer'}));
 assert.equal(asked['ready-candidate'].verdict, 'READY_FOR_REVIEW');
 assert.equal(asked['ready-candidate'].rule, 17);
 assert.deepEqual(asked['ready-candidate'].contact.outstandingAxes, []);

 // The parties we are actually mid-conversation with are still stopped, on their own
 // records, before any of this - which is where that protection belongs.
 assert.equal(asked['already-contacted'].verdict, 'IGNORE');
 assert.equal(asked['already-contacted'].rule, 3);
 assert.equal(asked['opted-out'].verdict, 'IGNORE');

 // And a different question changes nothing, because it never depended on the axis.
 const free = byId(await run({asking: 'workflow'}));
 assert.equal(free['ready-candidate'].verdict, 'READY_FOR_REVIEW');
});

test('every mechanical rule carries an explicit confidence band', () => {
 assert.deepEqual(UNBANDED_RULES, [], 'a new check must be banded on purpose before it can support a contact');
 assert.deepEqual(Object.keys(RULE_CONFIDENCE).sort(), Object.keys(RULES).sort());
 for (const band of Object.values(RULE_CONFIDENCE)) assert.ok(CONFIDENCE_BANDS.includes(band), band);
 // An unknown rule is never evidence for contacting anyone.
 assert.equal(bandOf('some-future-rule'), 'INTENTIONAL_RISK');

 assert.deepEqual(bandCounts({'missing-ja': 3, 'placeholder-set-mismatch': 2, 'edge-whitespace': 10}),
  {HIGH_CONFIDENCE: 2, INTENTIONAL_RISK: 10, INCOMPLETE_LOCALE: 3});
 // Incomplete-locale findings stay out of the noise ratio; locale completeness governs them.
 assert.equal(noiseRatio({HIGH_CONFIDENCE: 2, INTENTIONAL_RISK: 0, INCOMPLETE_LOCALE: 900}), 0);
 assert.equal(noiseRatio({HIGH_CONFIDENCE: 0, INTENTIONAL_RISK: 0, INCOMPLETE_LOCALE: 0}), 0);
});

// The confidence layer sits on top of the seven checks. It must not have moved any of them.
test('the seven mechanical checks are unchanged', () => {
 assert.deepEqual(RULES, {
  'missing-ja': 'ERROR',
  'empty-ja': 'ERROR',
  'placeholder-set-mismatch': 'ERROR',
  'edge-whitespace': 'WARN',
  'halfwidth-katakana': 'WARN',
  'fullwidth-space': 'WARN',
  'placeholder-multiplicity-mismatch': 'INFO'
 });
 assert.deepEqual(ADVISORY_RULES, ['edge-whitespace']);
 assert.deepEqual(BLANK_RULES, ['missing-ja', 'empty-ja']);
 // Severity and confidence are orthogonal: a WARN can be high-confidence and a WARN can not be.
 assert.equal(RULE_CONFIDENCE['halfwidth-katakana'], 'HIGH_CONFIDENCE');
 assert.equal(RULE_CONFIDENCE['fullwidth-space'], 'INTENTIONAL_RISK');
});

test('external metadata is validated, and an absent field is never guessed', () => {
 assert.deepEqual(emptyEntry(), {
  aliases: [], activity: 'UNKNOWN', activity_evidence: null,
  public_contact_route: 'UNKNOWN', contact_route_evidence: null, contact_ids: undefined, notes: null,
  // The candidate's public identity: what the contact store gets checked *with*. Absent
  // by default, like every other field here, and an absent identity is why a candidate
  // reads UNCHECKED rather than "never contacted".
  owner: null, repository: null, url: null, emails: []
 });
 const loaded = loadMetadata(JSON.stringify({schema: 'yn0-prospect-metadata-v1', prospects: {a: {activity: 'ACTIVE'}}}));
 assert.equal(loaded.prospects.get('a').activity, 'ACTIVE');
 assert.equal(loaded.prospects.get('a').contact_ids, undefined, '"nobody checked" and "checked, none" stay different claims');
 assert.deepEqual(loadMetadata(JSON.stringify({prospects: {a: {contact_ids: []}}})).prospects.get('a').contact_ids, []);

 const bad = [
  '{',
  JSON.stringify({schema: 'something-else', prospects: {}}),
  JSON.stringify({}),
  JSON.stringify({prospects: {a: {activity: 'ALIVE'}}}),
  JSON.stringify({prospects: {a: {public_contact_route: 'DM'}}}),
  JSON.stringify({prospects: {a: {contact_id: 'typo'}}}),
  JSON.stringify({prospects: {a: {contact_ids: 'not-an-array'}}})
 ];
 for (const text of bad) assert.throws(() => loadMetadata(text), ProspectMetadataError, text.slice(0, 40));
});

test('aggregation folds every pair in a repository into one evidence record', () => {
 const pair = (over = {}) => ({
  enKeyCount: 10, jaKeyCount: 10, blankFindings: 0, totalFindings: 0,
  findingsByRule: {}, classification: 'CLEAN', ...over
 });
 const evidence = aggregate({
  pairs: [
   pair({totalFindings: 2, findingsByRule: {'placeholder-set-mismatch': 1, 'edge-whitespace': 1}, classification: 'HIGH_FIT'}),
   pair({blankFindings: 4, totalFindings: 4, findingsByRule: {'missing-ja': 4}, classification: 'TOO_NOISY'})
  ],
  skipped: []
 });
 assert.equal(evidence.enKeyCount, 20);
 assert.equal(evidence.untranslatedKeys, 4);
 assert.equal(evidence.localeCompleteness, 0.8);
 assert.equal(evidence.highConfidenceFindings, 1);
 assert.equal(evidence.intentionalRiskFindings, 1);
 assert.equal(evidence.incompleteLocaleFindings, 4);
 assert.equal(evidence.noiseRatio, 0.5);
 assert.deepEqual(evidence.scannerClassifications, {HIGH_FIT: 1, TOO_NOISY: 1});
 assert.deepEqual(aggregate({pairs: [], skipped: []}).localeCompleteness, 0);
});

test('the report is deterministic and carries no clock', async () => {
 const first = JSON.stringify(await run(), null, 2);
 const second = JSON.stringify(await run(), null, 2);
 assert.equal(first, second);
 for (const marker of ['"scannedAt"', '"generatedAt"', '"timestamp"']) assert.equal(first.includes(marker), false, marker);
 assert.ok(renderText(await run()).includes('This report is a reading list'));
});

test('discovery never rewrites the tree it reads', async () => {
 const before = await Promise.all((await walk(workspace)).map(rel => readFile(path.join(workspace, rel), 'utf8')));
 await run();
 const after = await Promise.all((await walk(workspace)).map(rel => readFile(path.join(workspace, rel), 'utf8')));
 assert.deepEqual(after, before);
});

// This layer reads contact-state and a filesystem. It has no way to reach a person, and
// that is a property worth a test rather than a comment.
test('the engine has no outreach or network surface', async () => {
 const sources = [];
 const collect = async dir => {
  for (const item of (await readdir(dir, {withFileTypes: true})).sort((a, b) => (a.name < b.name ? -1 : 1))) {
   const next = path.join(dir, item.name);
   if (item.isDirectory()) await collect(next);
   else if (item.name.endsWith('.mjs')) sources.push([next, await readFile(next, 'utf8')]);
  }
 };
 await collect(path.join(scannerDir, 'lib'));
 for (const name of ['scan.mjs', 'prospect.mjs']) sources.push([name, await readFile(path.join(scannerDir, name), 'utf8')]);

 const forbidden = ['node:http', 'node:https', 'node:net', 'node:child_process', 'fetch(', 'XMLHttpRequest',
  'nodemailer', 'sendmail', 'smtp', 'octokit', 'api.github.com'];
 for (const [name, text] of sources) {
  for (const marker of forbidden) {
   assert.equal(text.toLowerCase().includes(marker.toLowerCase()), false, name + ' must not reference ' + marker);
  }
 }
 assert.ok(sources.length >= 8, 'the scan found the modules it meant to check');
});

// The rule that survives every refactor: real contacts live in an untracked local store.
test('no real contact information can reach a tracked fixture', async () => {
 const ignore = await readFile(path.join(scannerDir, '.gitignore'), 'utf8');
 for (const rule of ['*.local.json', '*.local.md']) {
  assert.ok(ignore.split('\n').includes(rule), 'internal/distribution-scanner/.gitignore must ignore ' + rule);
 }

 const tracked = [];
 const collect = async dir => {
  for (const item of (await readdir(dir, {withFileTypes: true})).sort((a, b) => (a.name < b.name ? -1 : 1))) {
   const next = path.join(dir, item.name);
   if (item.isDirectory()) await collect(next);
   else tracked.push([path.relative(fixtures, next), await readFile(next, 'utf8')]);
  }
 };
 await collect(fixtures);
 for (const [name, text] of tracked) {
  assert.equal(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text), false, name + ' carries something shaped like an email address');
  assert.equal(/https?:\/\/(?!example\.)/i.test(text), false, name + ' carries a live URL');
 }

 const {contacts} = await loadFixtures();
 for (const {contact} of contacts.contacts) {
  assert.match(contact.id, /-shape$/, 'a fixture contact id names a conversation shape, never a party');
  assert.match(contact.name, /^Prospect [A-Z]$/, contact.id);
  assert.match(contact.organization, /^Example /, contact.id);
  assert.equal(contact.channel_ref, null, contact.id + ' must not carry a thread reference');
 }

 // And no prospect report ever copies a contact record across the boundary: what crosses
 // is an enum and the ids it came from, never a name, an organization or an evidence quote.
 const report = JSON.stringify(await run());
 for (const {contact} of contacts.contacts) {
  assert.equal(report.includes(contact.name), false, contact.name + ' leaked into the prospect report');
  assert.equal(report.includes(contact.organization), false, contact.organization + ' leaked into the prospect report');
 }
});

test('inventory and discovery refuse a path that is not a directory', async () => {
 await assert.rejects(() => discover(path.join(workspace, 'does-not-exist')));
 await assert.rejects(() => discover(path.join(workspace, 'clean-repo', 'locales', 'en.json')), /not a directory/);
 await assert.rejects(() => inventory(path.join(workspace, 'does-not-exist')));
});

test('CLI argument parsing', () => {
 assert.deepEqual(parseArgs(['work']).options.format, 'text');
 const parsed = parseArgs(['work', '--single', '--format', 'json', '--asking', 'payer', '--verdict', 'IGNORE',
  '--samples', '2', '--min-completeness', '0.5', '--max-noise-ratio', '0.7']);
 assert.equal(parsed.target, 'work');
 assert.equal(parsed.options.single, true);
 assert.equal(parsed.options.asking, 'payer');
 assert.equal(parsed.options.verdict, 'IGNORE');
 assert.equal(parsed.options.samples, 2);
 assert.deepEqual(parsed.options.thresholds, {minCompleteness: 0.5, maxNoiseRatio: 0.7});
 assert.deepEqual(parseArgs(['--help']), {help: true});
 for (const argv of [[], ['a', 'b'], ['w', '--format', 'yaml'], ['w', '--asking', 'price'],
  ['w', '--verdict', 'CONTACT'], ['w', '--nope'], ['w', '--samples', 'x'], ['w', '--contacts']]) {
  assert.throws(() => parseArgs(argv), Error, JSON.stringify(argv));
 }
});
