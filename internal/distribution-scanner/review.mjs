#!/usr/bin/env node
// YN0 Prospect Discovery v3 - review pass (internal).
//
//   node internal/distribution-scanner/review.mjs <workspace> [options]
//
// Takes a workspace of candidate repositories (materialized by discovery/explore.mjs or
// assembled by hand), the manifest describing them, the contact store and the current
// validation hypothesis, and produces the queue a person reads.
//
// Offline and deterministic. No network, no credentials, no outreach, no edits to the
// scanned tree. The pipeline ends at HUMAN REVIEW and there is no step after it.
import {readFile, writeFile} from 'node:fs/promises';
import {VALIDATION_AXES} from '../contact-state/lib/model.mjs';
import {readContactStore} from './lib/contact-link.mjs';
import {loadManifest} from './lib/manifest.mjs';
import {loadHypothesis} from './lib/hypothesis.mjs';
import {DEFAULT_PROSPECT_THRESHOLDS} from './lib/candidates.mjs';
import {LANES} from './lib/queue.mjs';
import {DEFAULT_SAMPLES} from './lib/prospects.mjs';
import {renderText, review} from './lib/review.mjs';

const USAGE = `YN0 Prospect Discovery v3 - review pass (internal)

Usage:
  node internal/distribution-scanner/review.mjs <workspace> [options]

Each immediate subdirectory of <workspace> is treated as one candidate repository.

Options:
  --single                 Treat <workspace> itself as one repository
  --manifest <file>        Candidate manifest (yn0-candidate-manifest-v1) from discovery/
  --contacts <file>        contact-state store to check against (see internal/contact-state).
                           Without it no candidate can be shown as never contacted, and the
                           hypothesis falls back to "nothing is settled".
  --hypothesis <file>      Explicit validation hypothesis (yn0-validation-hypothesis-v1).
                           Without it the hypothesis is derived from the contact store.
  --asking <axis>          Ask about this axis instead of the highest-priority open one
                           (${VALIDATION_AXES.join(' | ')})
  --lane <LANE>            Report only ${LANES.join(' | ')}
  --format <text|json>     Output format on stdout (default: text)
  --out <file>             Also write the JSON report to <file>
  --samples <n>            Findings shown per candidate (default: ${DEFAULT_SAMPLES})
  --min-completeness <r>   Locale completeness floor (default: ${DEFAULT_PROSPECT_THRESHOLDS.minCompleteness})
  --min-high-confidence <n> High-confidence findings required (default: ${DEFAULT_PROSPECT_THRESHOLDS.minHighConfidence})
  --max-noise-ratio <r>    Citable findings that may be intentional-risk (default: ${DEFAULT_PROSPECT_THRESHOLDS.maxNoiseRatio})
  -h, --help               Show this help

Example:
  node internal/distribution-scanner/review.mjs ~/prospects/workspace \\
    --manifest ~/prospects/manifest.local.json \\
    --contacts internal/contact-state/contacts.local.json
`;

const VALUED = {
 '--manifest': 'manifest',
 '--contacts': 'contacts',
 '--hypothesis': 'hypothesis',
 '--format': 'format',
 '--out': 'out',
 '--asking': 'asking',
 '--lane': 'lane'
};

const NUMERIC = {
 '--samples': ['samples', Number.parseInt],
 '--min-completeness': ['minCompleteness', Number.parseFloat],
 '--min-high-confidence': ['minHighConfidence', Number.parseInt],
 '--max-noise-ratio': ['maxNoiseRatio', Number.parseFloat]
};

export function parseArgs(argv) {
 const options = {format: 'text', out: null, single: false, manifest: null, contacts: null,
  hypothesis: null, asking: null, lane: null, thresholds: {}};
 let target = null;
 for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '-h' || arg === '--help') return {help: true};
  if (arg === '--single') {
   options.single = true;
   continue;
  }
  if (VALUED[arg]) {
   const value = argv[++i];
   if (value === undefined) throw new Error('missing value for ' + arg);
   if (arg === '--format' && value !== 'text' && value !== 'json') throw new Error('unknown format: ' + value);
   if (arg === '--asking' && !VALIDATION_AXES.includes(value)) throw new Error('unknown validation axis: ' + value);
   if (arg === '--lane' && !LANES.includes(value)) throw new Error('unknown lane: ' + value);
   options[VALUED[arg]] = value;
   continue;
  }
  if (NUMERIC[arg]) {
   const [name, parse] = NUMERIC[arg];
   const value = parse(argv[++i]);
   if (!Number.isFinite(value) || value < 0) throw new Error('invalid value for ' + arg);
   if (name === 'samples') options.samples = value;
   else options.thresholds[name] = value;
   continue;
  }
  if (arg.startsWith('-')) throw new Error('unknown option: ' + arg);
  if (target !== null) throw new Error('only one workspace may be reviewed at a time');
  target = arg;
 }
 if (target === null) throw new Error('a path to review is required');
 return {target, options};
}

async function main(argv) {
 let parsed;
 try {
  parsed = parseArgs(argv);
 } catch (error) {
  process.stderr.write(error.message + '\n\n' + USAGE);
  return 2;
 }
 if (parsed.help) {
  process.stdout.write(USAGE);
  return 0;
 }
 const {target, options} = parsed;

 let report;
 try {
  const contacts = options.contacts ? readContactStore(await readFile(options.contacts, 'utf8'), options.contacts) : null;
  const manifest = options.manifest ? loadManifest(await readFile(options.manifest, 'utf8'), options.manifest) : null;
  const hypothesis = options.hypothesis ? loadHypothesis(await readFile(options.hypothesis, 'utf8'), options.hypothesis) : null;
  report = await review(target, {...options, contacts, manifest, hypothesis});
 } catch (error) {
  process.stderr.write('review failed: ' + error.message + '\n');
  return 1;
 }
 if (options.lane) {
  report = {...report, candidates: report.candidates.filter(candidate => candidate.lane === options.lane)};
 }

 const json = JSON.stringify(report, null, 2);
 if (options.out) await writeFile(options.out, json + '\n');
 process.stdout.write((options.format === 'json' ? json : renderText(report)) + '\n');
 return 0;
}

if (import.meta.url === 'file://' + process.argv[1]) process.exitCode = await main(process.argv.slice(2));
