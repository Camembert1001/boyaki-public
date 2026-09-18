// Tests for the YN0 Distribution Scanner. Run with:
//   node --test internal/distribution-scanner/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scan, classify, DEFAULT_THRESHOLDS} from '../lib/scanner.mjs';
import {checkEntry, checkPair, flatten, PLACEHOLDER_PATTERN, placeholders} from '../lib/checks.mjs';
import {classifyPath, pairLocaleFiles, walk} from '../lib/discover.mjs';
import {parseArgs} from '../scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '..', 'fixtures');
const repoRoot = path.join(here, '..', '..', '..');
const byEnPath = report => Object.fromEntries(report.pairs.map(pair => [pair.en, pair]));

test('every fixture lands in its intended prospect bucket with the intended rule counts', async () => {
 const pairs = byEnPath(await scan(fixtures));
 const expected = {
  'clean/locales/en.json': ['CLEAN', {}],
  'missing-empty/lang/en-US.json': ['HIGH_FIT', {'empty-ja': 1, 'missing-ja': 1}],
  'placeholder-set/translations/strings-en.json': ['HIGH_FIT', {'placeholder-set-mismatch': 1}],
  'placeholder-multiplicity/locale/en_GB.json': ['HIGH_FIT', {'placeholder-multiplicity-mismatch': 1}],
  'edge-whitespace/messages/en.json': ['CLEAN', {'edge-whitespace': 3}],
  'advisory-noise/lang/en.json': ['HIGH_FIT', {'edge-whitespace': 12, 'placeholder-multiplicity-mismatch': 1}],
  'halfwidth-katakana/resources/en.json': ['HIGH_FIT', {'halfwidth-katakana': 1}],
  'ideographic-space/languages/en.json': ['HIGH_FIT', {'fullwidth-space': 1}],
  'too-noisy/i18n/en/common.json': ['TOO_NOISY', {'empty-ja': 8, 'missing-ja': 2}]
 };
 assert.deepEqual(Object.keys(pairs).sort(), Object.keys(expected).sort());
 for (const [en, [classification, findingsByRule]] of Object.entries(expected)) {
  assert.equal(pairs[en].classification, classification, en);
  assert.deepEqual(pairs[en].findingsByRule, findingsByRule, en);
 }
 assert.deepEqual(await scan(fixtures).then(r => r.summary), {HIGH_FIT: 6, CLEAN: 2, REVIEW: 0, TOO_NOISY: 1});
 assert.deepEqual((await scan(fixtures)).skipped, []);
});

test('output is deterministic across runs', async () => {
 const first = JSON.stringify(await scan(fixtures), null, 2);
 const second = JSON.stringify(await scan(fixtures), null, 2);
 assert.equal(first, second);
 assert.equal(first.includes('"scannedAt"'), false, 'report must not carry a timestamp');
});

test('scanning never rewrites the scanned tree', async () => {
 const before = await Promise.all((await walk(fixtures)).map(rel => readFile(path.join(fixtures, rel), 'utf8')));
 await scan(fixtures);
 const after = await Promise.all((await walk(fixtures)).map(rel => readFile(path.join(fixtures, rel), 'utf8')));
 assert.deepEqual(after, before);
});

test('placeholder set mismatch is separated from multiplicity-only mismatch', () => {
 const set = checkEntry('k', 'Hello {{name}}', 'こんにちは{{user}}');
 assert.deepEqual(set.map(f => f.rule), ['placeholder-set-mismatch']);
 assert.equal(set[0].severity, 'ERROR');

 const multiplicity = checkEntry('k', '{0} defeated {1}.', '{0}は{1}を倒した。{0}の勝利。');
 assert.deepEqual(multiplicity.map(f => f.rule), ['placeholder-multiplicity-mismatch']);
 assert.equal(multiplicity[0].severity, 'INFO', 'a repeated placeholder is reported, not treated as a defect');

 assert.deepEqual(checkEntry('k', 'Score: {count}', 'スコア: {count}'), []);
});

test('placeholder extraction matches the public JP UI Preflight', async () => {
 const preflight = await readFile(path.join(repoRoot, 'yn0-jp-ui-preflight', 'index.html'), 'utf8');
 assert.ok(preflight.includes(PLACEHOLDER_PATTERN.source), 'scanner placeholder pattern has drifted from the public tool');
 assert.deepEqual(placeholders('{{a}} {b} {0} {0:0.#} %s %d %1$s'), ['%1$s', '%d', '%s', '{0:0.#}', '{0}', '{b}', '{{a}}']);
});

test('each mechanical check fires on its own trigger and stays quiet otherwise', () => {
 assert.deepEqual(checkEntry('k', 'Save', undefined).map(f => f.rule), ['missing-ja']);
 assert.deepEqual(checkEntry('k', 'Save', '  ').map(f => f.rule), ['empty-ja', 'edge-whitespace']);
 assert.deepEqual(checkEntry('k', 'Save', '保存 ').map(f => f.rule), ['edge-whitespace']);
 assert.deepEqual(checkEntry('k', 'Save', 'ｾｰﾌﾞ').map(f => f.rule), ['halfwidth-katakana']);
 assert.deepEqual(checkEntry('k', 'Main Menu', 'メイン　メニュー').map(f => f.rule), ['fullwidth-space']);
 assert.deepEqual(checkEntry('k', 'Save', '保存'), []);
 // A key present only in JA is checked on the JA side and never reported as an extra key.
 assert.deepEqual(checkPair({}, {only: '保存'}), []);
 assert.deepEqual(checkPair({}, {only: '保存 '}).map(f => f.rule), ['edge-whitespace']);
});

test('nested and flat JSON both flatten to comparable keys', () => {
 assert.deepEqual(flatten({menu: {save: 'Save'}, tips: ['a', 'b'], count: 3, missing: null}),
  {'menu.save': 'Save', 'tips.0': 'a', 'tips.1': 'b', count: '3', missing: ''});
});

test('locale discovery recognises the documented naming conventions', () => {
 const cases = [
  ['locales/en.json', 'en', 'locales/*.json'],
  ['locales/ja.json', 'ja', 'locales/*.json'],
  ['lang/en-US.json', 'en', 'lang/*.json'],
  ['lang/ja_JP.json', 'ja', 'lang/*.json'],
  ['translations/strings-en.json', 'en', 'translations/strings-*.json'],
  ['translations/strings-ja.json', 'ja', 'translations/strings-*.json'],
  ['messages/en.messages.json', 'en', 'messages/*.messages.json'],
  ['i18n/ja/common.json', 'ja', 'i18n/*/common.json'],
  ['resources/en_GB.json', 'en', 'resources/*.json']
 ];
 for (const [relPath, lang, groupKey] of cases) {
  assert.deepEqual({lang: classifyPath(relPath).lang, groupKey: classifyPath(relPath).groupKey}, {lang, groupKey}, relPath);
 }
 for (const relPath of ['package.json', 'data/items.json', 'locales/fr.json', 'locales/en.csv', 'README.md']) {
  assert.equal(classifyPath(relPath), null, relPath);
 }
});

test('pairing prefers the region-less file and reports the alternates it skipped', () => {
 const pairs = pairLocaleFiles(['locales/en-US.json', 'locales/en.json', 'locales/ja.json', 'locales/fr.json']);
 assert.equal(pairs.length, 1);
 assert.equal(pairs[0].en, 'locales/en.json');
 assert.deepEqual(pairs[0].notes, ['alternate EN files not scanned: locales/en-US.json']);
 assert.deepEqual(pairLocaleFiles(['locales/en.json']), [], 'an unpaired EN file yields no pair');
});

test('thresholds are configurable rather than baked in', async () => {
 const strict = byEnPath(await scan(fixtures, {thresholds: {highFitMax: 1}}));
 assert.equal(strict['missing-empty/lang/en-US.json'].classification, 'REVIEW');
 assert.equal(strict['halfwidth-katakana/resources/en.json'].classification, 'HIGH_FIT');

 const tolerant = byEnPath(await scan(fixtures, {thresholds: {noisyBlankRatio: 0.9}}));
 assert.equal(tolerant['too-noisy/i18n/en/common.json'].classification, 'HIGH_FIT');

 assert.equal((await scan(fixtures, {samples: 1})).pairs.every(pair => pair.samples.length <= 1), true);
});

// `classify` reads classifyingFindings / advisoryFindings; totalFindings is reported, not bucketed.
const stats = (enKeyCount, classifyingFindings, extra = {}) =>
 ({enKeyCount, classifyingFindings, advisoryFindings: 0, blankFindings: 0, blankRatio: 0, ...extra});

test('classification order puts an incomplete locale ahead of raw finding counts', () => {
 const noisy = classify(stats(2504, 1630, {blankFindings: 1630, blankRatio: 0.651}), DEFAULT_THRESHOLDS);
 assert.equal(noisy.classification, 'TOO_NOISY');
 assert.equal(classify(stats(492, 0), DEFAULT_THRESHOLDS).classification, 'CLEAN');
 assert.equal(classify(stats(4530, 2), DEFAULT_THRESHOLDS).classification, 'HIGH_FIT');
 assert.equal(classify(stats(1069, 30), DEFAULT_THRESHOLDS).classification, 'REVIEW');
 assert.equal(classify(stats(0, 0), DEFAULT_THRESHOLDS).classification, 'REVIEW');
});

// Regression: before advisory rules existed, PocketRoles' 47 deliberate edge spaces outvoted its
// single real finding and pushed a 1-finding prospect out of HIGH_FIT into REVIEW.
test('advisory findings are reported but never decide the bucket', async () => {
 const pair = byEnPath(await scan(fixtures))['advisory-noise/lang/en.json'];
 assert.equal(pair.classification, 'HIGH_FIT');
 assert.equal(pair.totalFindings, 13, 'every finding is still reported');
 assert.equal(pair.classifyingFindings, 1);
 assert.equal(pair.advisoryFindings, 12);
 assert.ok(pair.totalFindings > DEFAULT_THRESHOLDS.highFitMax,
  'the fixture only guards the regression while its raw count would otherwise miss the high-fit band');
 assert.match(pair.reason, /12 advisory findings reported but not classified/);
 assert.ok(pair.samples.some(sample => sample.rule === 'edge-whitespace'),
  'advisory findings still surface in the samples a reviewer reads');

 // Only edge whitespace is advisory. Half-width katakana and U+3000 are defect claims and still classify.
 assert.deepEqual((await scan(fixtures)).advisoryRules, ['edge-whitespace']);
 const pairs = byEnPath(await scan(fixtures));
 assert.equal(pairs['halfwidth-katakana/resources/en.json'].classifyingFindings, 1);
 assert.equal(pairs['ideographic-space/languages/en.json'].classifyingFindings, 1);
});

test('a pair whose only findings are advisory reads CLEAN and says why', async () => {
 const pair = byEnPath(await scan(fixtures))['edge-whitespace/messages/en.json'];
 assert.equal(pair.classification, 'CLEAN');
 assert.equal(pair.classifyingFindings, 0);
 assert.equal(pair.advisoryFindings, 3);
 assert.match(pair.reason, /3 advisory findings reported but not classified/,
  'CLEAN must not imply the padding went unseen');
});

// The five benchmark repositories from issue #9, pinned as the counts observed during validation.
// Live repositories drift; these assert the classifier's behaviour on those shapes, not the repos.
test('observed benchmark shapes land in their documented buckets', () => {
 const cases = [
  ['BlocksBeyondTheStars', stats(3962, 3, {advisoryFindings: 2, blankFindings: 1, blankRatio: 1 / 3962}), 'HIGH_FIT'],
  ['PocketRoles', stats(1069, 1, {advisoryFindings: 47}), 'HIGH_FIT'],
  ['CritterDex', stats(492, 0), 'CLEAN'],
  ['Orrery', stats(3114, 0), 'CLEAN'],
  ['Deadlock Mod Manager', stats(2694, 1995, {blankFindings: 1765, blankRatio: 1765 / 2694}), 'TOO_NOISY']
 ];
 for (const [name, benchmark, expected] of cases) {
  assert.equal(classify(benchmark, DEFAULT_THRESHOLDS).classification, expected, name);
 }
});

test('CLI argument parsing', () => {
 assert.deepEqual(parseArgs(['fixtures']), {target: 'fixtures', options: {format: 'text', out: null, thresholds: {}}});
 const parsed = parseArgs(['fixtures', '--format', 'json', '--samples', '2', '--noisy-blank-ratio', '0.5']);
 assert.equal(parsed.options.format, 'json');
 assert.equal(parsed.options.samples, 2);
 assert.deepEqual(parsed.options.thresholds, {noisyBlankRatio: 0.5});
 assert.deepEqual(parseArgs(['--help']), {help: true});
 for (const argv of [[], ['a', 'b'], ['fixtures', '--format', 'yaml'], ['fixtures', '--nope'], ['fixtures', '--samples', 'x']]) {
  assert.throws(() => parseArgs(argv), Error, JSON.stringify(argv));
 }
});

test('a scan path that is missing or not a directory fails loudly', async () => {
 await assert.rejects(() => scan(path.join(fixtures, 'does-not-exist')));
 await assert.rejects(() => scan(path.join(fixtures, 'clean', 'locales', 'en.json')), /not a directory/);
});
