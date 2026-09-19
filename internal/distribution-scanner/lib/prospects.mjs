// Orchestration for the YN0 Prospect Discovery layer.
//
//   repository
//     -> localization asset inventory      (assets.mjs)
//     -> EN/JA pair discovery              (discover.mjs, unchanged)
//     -> mechanical scan                   (scanner.mjs, unchanged)
//     -> finding confidence / noise        (confidence.mjs)
//     -> repository suitability evidence   (this module + metadata.mjs)
//     -> contact-state check               (contact-link.mjs)
//     -> candidate classification          (candidates.mjs)
//     -> human review
//
// The pipeline ends at "human review" and there is no step after it. Nothing here
// sends mail, opens an issue, writes a comment, fills a form, drives a browser, holds
// a credential or makes a network call; the report is a reading list, not a queue.
//
// Deterministic by construction, like the scanner it sits on: sorted traversal, sorted
// output, no timestamps, no randomness.
import {readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {SKIP_DIRS} from './discover.mjs';
import {scan} from './scanner.mjs';
import {inventory} from './assets.mjs';
import {RULE_CONFIDENCE, isHighConfidence} from './confidence.mjs';
import {emptyEntry} from './metadata.mjs';
import {identityCoverage} from '../../contact-state/lib/store.mjs';
import {outstandingAxes, resolvePosture} from './contact-link.mjs';
import {DEFAULT_PROSPECT_THRESHOLDS, VERDICTS, aggregate, decide} from './candidates.mjs';

export const SCHEMA = 'yn0-prospect-discovery-report-v1';
export const DEFAULT_SAMPLES = 5;

// How deep the underlying scan samples findings before this layer picks the
// high-confidence ones out. Bounded so a 10,000-finding repository stays cheap, and
// larger than any plausible `--samples` so the evidence shown is not an accident of
// severity ordering.
export const SCAN_SAMPLE_DEPTH = 200;

const listRepositories = async root =>
 (await readdir(root, {withFileTypes: true}))
  .filter(item => item.isDirectory() && !item.isSymbolicLink() && !SKIP_DIRS.has(item.name))
  .map(item => item.name)
  .sort();

// Evidence a reviewer actually reads: the high-confidence findings first, because those
// are the ones a contact could be justified by. When there are none, the other findings
// are shown anyway - a HUMAN_REVIEW row with no findings printed is not reviewable.
function pickSamples(scanReport, limit) {
 const all = scanReport.pairs.flatMap(pair => pair.samples.map(sample => ({...sample, en: pair.en, ja: pair.ja})));
 const high = all.filter(isHighConfidence);
 return (high.length ? high : all).slice(0, limit);
}

export async function evaluate(root, id, relPath, options) {
 const scanReport = await scan(root, {thresholds: options.scanThresholds, samples: SCAN_SAMPLE_DEPTH});
 const assets = await inventory(root);
 const metadata = options.metadata?.prospects.get(id) ?? emptyEntry();
 // What this party can be recognized by in public. Without at least one of these the
 // contact store cannot be asked about them, and "never contacted" stays unproven.
 const identity = {
  id,
  owner: metadata.owner,
  repository: metadata.repository,
  url: metadata.url,
  aliases: metadata.aliases,
  emails: metadata.emails
 };
 const contact = resolvePosture(options.contacts ?? null, metadata.contact_ids, [id, ...metadata.aliases], identity);
 const evidence = aggregate(scanReport);
 const {rule, verdict, reason} = decide({
  contact,
  metadata,
  assets,
  evidence,
  asking: options.asking ?? null,
  outstandingAxes: options.outstandingAxes
 }, options.thresholds);

 return {
  id,
  path: relPath,
  verdict,
  rule,
  reason,
  contact,
  metadata: {
   activity: metadata.activity,
   activity_evidence: metadata.activity_evidence,
   public_contact_route: metadata.public_contact_route,
   contact_route_evidence: metadata.contact_route_evidence,
   aliases: metadata.aliases,
   contact_link_declared: metadata.contact_ids !== undefined,
   owner: metadata.owner,
   repository: metadata.repository,
   url: metadata.url,
   notes: metadata.notes
  },
  assets,
  evidence,
  samples: pickSamples(scanReport, options.samples),
  skipped: scanReport.skipped,
  notes: scanReport.pairs.flatMap(pair => pair.notes)
 };
}

// Walk a workspace of candidate repositories (one per immediate subdirectory), or a
// single repository with `single: true`, and classify each one.
export async function discover(rootPath, options = {}) {
 const thresholds = {...DEFAULT_PROSPECT_THRESHOLDS, ...options.thresholds};
 const samples = options.samples ?? DEFAULT_SAMPLES;
 const root = path.resolve(rootPath);

 const info = await stat(root);
 if (!info.isDirectory()) throw new Error('prospect path is not a directory: ' + rootPath);

 const shared = {
  thresholds,
  scanThresholds: options.scanThresholds,
  samples,
  metadata: options.metadata ?? null,
  contacts: options.contacts ?? null,
  asking: options.asking ?? null,
  outstandingAxes: options.contacts ? outstandingAxes(options.contacts) : []
 };

 const prospects = options.single
  ? [await evaluate(root, path.basename(root), '.', shared)]
  : [];
 if (!options.single) {
  for (const name of await listRepositories(root)) {
   prospects.push(await evaluate(path.join(root, name), name, name, shared));
  }
 }

 const summary = Object.fromEntries(VERDICTS.map(verdict => [verdict, prospects.filter(p => p.verdict === verdict).length]));
 return {
  schema: SCHEMA,
  root: path.relative(process.cwd(), root) || '.',
  mode: options.single ? 'single' : 'workspace',
  thresholds,
  sampleLimit: samples,
  ruleConfidence: RULE_CONFIDENCE,
  asking: shared.asking,
  contactStore: {
   provided: Boolean(options.contacts),
   contactCount: options.contacts ? options.contacts.contacts.length : 0,
   // Whether the store can answer "not this party" at all. One contact with no identity
   // evidence is enough to make that answer unavailable for everybody, so the figure is
   // reported next to the count rather than left to be inferred from the verdicts.
   identityCoverage: options.contacts
    ? identityCoverage(options.contacts)
    : {contactCount: 0, indexedCount: 0, opaqueCount: 0, opaqueIds: [], complete: false},
   outstandingAxes: shared.outstandingAxes
  },
  prospectCount: prospects.length,
  summary,
  prospects
 };
}

const percent = value => (value * 100).toFixed(1) + '%';

export function renderText(report) {
 const lines = [];
 lines.push('YN0 Prospect Discovery - ' + report.root + ' (' + report.mode + ')');
 lines.push(report.prospectCount + ' prospect' + (report.prospectCount === 1 ? '' : 's') + ' - ' +
  VERDICTS.map(verdict => verdict + ' ' + report.summary[verdict]).join(' - '));
 const coverage = report.contactStore.identityCoverage;
 lines.push('contact store: ' + (report.contactStore.provided
  ? report.contactStore.contactCount + ' contact(s), ' + coverage.indexedCount + ' with identity evidence, ' +
    'outstanding axes: ' + (report.contactStore.outstandingAxes.join(', ') || 'none')
  : 'not provided - no prospect can be shown as never contacted'));
 if (report.contactStore.provided && !coverage.complete) {
  lines.push('  ! the store cannot answer "not this party": ' + (coverage.contactCount === 0
   ? 'it holds no contacts at all'
   : coverage.opaqueCount + ' contact(s) carry no identity evidence (' + coverage.opaqueIds.join(', ') + ')') +
   ' - every automatic lookup stays UNCHECKED until that is fixed');
 }
 if (report.asking) lines.push('asking about: ' + report.asking);

 for (const prospect of report.prospects) {
  const e = prospect.evidence;
  lines.push('');
  lines.push('[' + prospect.verdict + '] ' + prospect.id + '  (rule ' + prospect.rule + ')');
  lines.push('  reason: ' + prospect.reason);
  lines.push('  contact: ' + prospect.contact.posture +
   (prospect.contact.contactIds.length ? ' - ' + prospect.contact.contactIds.join(', ') : '') +
   ' [' + prospect.contact.conclusion + (prospect.contact.matchState ? '/' + prospect.contact.matchState : '') + ']' +
   ' - activity ' + prospect.metadata.activity + ' - route ' + prospect.metadata.public_contact_route);
  const formats = prospect.assets.formats.map(item =>
   item.format + ' x' + item.fileCount + (item.support === 'SUPPORTED' ? '' : ' [DETECTED_BUT_UNSUPPORTED]') +
   (item.languages.length ? ' (' + item.languages.join(',') + ')' : ''));
  lines.push('  assets: ' + (formats.length ? formats.join(' - ') : 'none'));
  lines.push('  evidence: ' + e.pairCount + ' pair(s) - EN ' + e.enKeyCount + ' keys - locale ' + percent(e.localeCompleteness) +
   ' complete - findings ' + e.totalFindings + ' (high ' + e.highConfidenceFindings +
   ', intentional-risk ' + e.intentionalRiskFindings + ', incomplete-locale ' + e.incompleteLocaleFindings +
   ', noise ' + e.noiseRatio + ')');
  for (const sample of prospect.samples) {
   lines.push('  - ' + sample.severity.padEnd(5) + ' ' + sample.rule + ' [' + sample.key + '] ' + sample.detail);
  }
  for (const note of prospect.notes) lines.push('  note: ' + note);
  for (const entry of prospect.skipped) lines.push('  skipped: ' + entry.en + ' <-> ' + entry.ja + ' - ' + entry.reason);
 }
 if (!report.prospectCount) lines.push('', 'No candidate repositories found under this path.');
 lines.push('');
 lines.push('This report is a reading list. It decides nothing about who is contacted, and nothing here contacts anyone.');
 return lines.join('\n');
}
