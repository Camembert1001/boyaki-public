// Orchestration for the YN0 Distribution Scanner: discover EN/JA pairs under a
// local path, read each side through its file adapter, run the mechanical checks on
// the normalized entries, and bucket each pair by prospect fit.
//
//   raw file -> file adapter -> normalized entries -> checks -> findings
//
// This module is the only one that touches the filesystem; it picks an adapter by
// extension and never parses a locale file itself.
//
// Deterministic by construction: sorted traversal, sorted findings, no timestamps,
// no randomness, no network.
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {walk, pairLocaleFiles} from './discover.mjs';
import {adapterForPath} from './adapters/index.mjs';
import {keyCount, pairEntries} from './entries.mjs';
import {checkEntries, RULES, BLANK_RULES, ADVISORY_RULES} from './checks.mjs';

export const SCHEMA = 'yn0-distribution-scanner-report-v1';

// Heuristics, not product truth. Every threshold is overridable from the CLI.
export const DEFAULT_THRESHOLDS = {
 highFitMax: 10,       // at most this many findings still counts as a workable prospect
 reviewMax: 50,        // more findings than this is noise, not a review queue
 noisyBlankRatio: 0.25 // share of EN keys with no Japanese value before the locale reads as incomplete
};
export const DEFAULT_SAMPLES = 5;

export const CLASSIFICATIONS = ['HIGH_FIT', 'CLEAN', 'REVIEW', 'TOO_NOISY'];

const round = value => Math.round(value * 10000) / 10000;
const percent = value => (value * 100).toFixed(1) + '%';

// Read one locale file through the adapter that claims its extension. Returns the
// adapter's own result: {ok: true, entries} or {ok: false, reason}.
async function readLocale(root, relPath) {
 const adapter = adapterForPath(relPath);
 if (!adapter) return {ok: false, reason: 'no file adapter for this extension'};
 let text;
 try {
  text = await readFile(path.join(root, relPath), 'utf8');
 } catch (error) {
  return {ok: false, reason: 'unreadable ' + adapter.label + ': ' + error.message};
 }
 return adapter.parse(text);
}

// Bucket one pair. Order matters: an incomplete locale is judged before finding counts,
// because hundreds of untranslated strings are not a review queue.
//
// Counts are taken over *classifying* findings only - every finding except the advisory
// rules (see ADVISORY_RULES). Advisory findings are still reported, sampled and counted in
// `totalFindings`; they just do not decide the bucket, so a project that pads strings on
// purpose is not pushed out of HIGH_FIT by its own house style.
export function classify(stats, thresholds) {
 const {enKeyCount, classifyingFindings, advisoryFindings, blankFindings, blankRatio} = stats;
 const advisoryNote = advisoryFindings
  ? ' ' + advisoryFindings + ' advisory finding' + (advisoryFindings === 1 ? '' : 's') + ' reported but not classified.'
  : '';
 if (enKeyCount === 0) {
  return {classification: 'REVIEW', reason: 'EN locale has no string entries to compare.'};
 }
 if (blankRatio >= thresholds.noisyBlankRatio) {
  return {
   classification: 'TOO_NOISY',
   reason: blankFindings + ' of ' + enKeyCount + ' EN keys have no Japanese value (' + percent(blankRatio) +
    ' >= ' + percent(thresholds.noisyBlankRatio) + '); the locale looks incomplete rather than defective.'
  };
 }
 if (classifyingFindings > thresholds.reviewMax) {
  return {
   classification: 'TOO_NOISY',
   reason: classifyingFindings + ' classifying findings exceed the review ceiling of ' + thresholds.reviewMax + '.' + advisoryNote
  };
 }
 if (classifyingFindings === 0) {
  return {classification: 'CLEAN', reason: 'No classifying findings under the current rule set.' + advisoryNote};
 }
 if (classifyingFindings <= thresholds.highFitMax) {
  return {
   classification: 'HIGH_FIT',
   reason: classifyingFindings + ' classifying finding' + (classifyingFindings === 1 ? '' : 's') +
    ' within the 1-' + thresholds.highFitMax + ' high-fit band.' + advisoryNote
  };
 }
 return {
  classification: 'REVIEW',
  reason: classifyingFindings + ' classifying findings above the high-fit band of ' + thresholds.highFitMax +
   ' but within the review ceiling of ' + thresholds.reviewMax + '.' + advisoryNote
 };
}

export async function scan(rootPath, options = {}) {
 const thresholds = {...DEFAULT_THRESHOLDS, ...options.thresholds};
 const sampleLimit = options.samples ?? DEFAULT_SAMPLES;
 const root = path.resolve(rootPath);

 const info = await stat(root);
 if (!info.isDirectory()) throw new Error('scan path is not a directory: ' + rootPath);

 const pairs = [];
 const skipped = [];
 for (const candidate of pairLocaleFiles(await walk(root))) {
  const [en, ja] = await Promise.all([readLocale(root, candidate.en), readLocale(root, candidate.ja)]);
  if (!en.ok || !ja.ok) {
   skipped.push({en: candidate.en, ja: candidate.ja, reason: en.ok ? candidate.ja + ': ' + ja.reason : candidate.en + ': ' + en.reason});
   continue;
  }

  const findings = checkEntries(pairEntries(en.entries, ja.entries));
  const findingsByRule = {};
  for (const item of findings) findingsByRule[item.rule] = (findingsByRule[item.rule] || 0) + 1;

  const enKeyCount = keyCount(en.entries);
  const blankFindings = BLANK_RULES.reduce((sum, rule) => sum + (findingsByRule[rule] || 0), 0);
  const advisoryFindings = ADVISORY_RULES.reduce((sum, rule) => sum + (findingsByRule[rule] || 0), 0);
  const stats = {
   enKeyCount,
   totalFindings: findings.length,
   advisoryFindings,
   classifyingFindings: findings.length - advisoryFindings,
   blankFindings,
   blankRatio: enKeyCount ? blankFindings / enKeyCount : 0
  };

  pairs.push({
   en: candidate.en,
   ja: candidate.ja,
   enKeyCount,
   jaKeyCount: keyCount(ja.entries),
   totalFindings: findings.length,
   classifyingFindings: stats.classifyingFindings,
   advisoryFindings,
   findingsByRule: Object.fromEntries(Object.keys(findingsByRule).sort().map(rule => [rule, findingsByRule[rule]])),
   blankFindings,
   blankRatio: round(stats.blankRatio),
   ...classify(stats, thresholds),
   samples: findings.slice(0, sampleLimit),
   notes: candidate.notes
  });
 }

 const summary = Object.fromEntries(CLASSIFICATIONS.map(name => [name, pairs.filter(p => p.classification === name).length]));
 return {
  schema: SCHEMA,
  root: path.relative(process.cwd(), root) || '.',
  thresholds,
  sampleLimit,
  rules: Object.fromEntries(Object.keys(RULES).sort().map(rule => [rule, RULES[rule]])),
  advisoryRules: [...ADVISORY_RULES].sort(),
  pairCount: pairs.length,
  summary,
  pairs,
  skipped
 };
}

// Concise human-readable rendering of a report produced by `scan`.
export function renderText(report) {
 const lines = [];
 lines.push('YN0 Distribution Scanner - ' + report.root);
 lines.push(report.pairCount + ' EN/JA pair' + (report.pairCount === 1 ? '' : 's') + ' - ' +
  CLASSIFICATIONS.map(name => name + ' ' + report.summary[name]).join(' - '));

 for (const pair of report.pairs) {
  lines.push('');
  lines.push('[' + pair.classification + '] ' + pair.en + ' <-> ' + pair.ja);
  lines.push('  keys: EN ' + pair.enKeyCount + ' - JA ' + pair.jaKeyCount +
   ' - findings ' + pair.totalFindings + ' (classifying ' + pair.classifyingFindings + ', advisory ' + pair.advisoryFindings +
   ', untranslated ' + pair.blankFindings + ', ' + percent(pair.blankRatio) + ')');
  const rules = Object.keys(pair.findingsByRule);
  lines.push('  rules: ' + (rules.length ? rules.map(rule => rule + ' ' + pair.findingsByRule[rule]).join(' - ') : 'none'));
  lines.push('  reason: ' + pair.reason);
  for (const note of pair.notes) lines.push('  note: ' + note);
  for (const sample of pair.samples) {
   lines.push('  - ' + sample.severity.padEnd(5) + ' ' + sample.rule + ' [' + sample.key + '] ' + sample.detail);
  }
  if (pair.totalFindings > pair.samples.length) {
   lines.push('  ... ' + (pair.totalFindings - pair.samples.length) + ' more finding(s) not sampled.');
  }
 }
 for (const entry of report.skipped) lines.push('', '[SKIPPED] ' + entry.en + ' <-> ' + entry.ja, '  reason: ' + entry.reason);
 if (!report.pairCount && !report.skipped.length) lines.push('', 'No EN/JA locale pairs discovered.');
 return lines.join('\n');
}
