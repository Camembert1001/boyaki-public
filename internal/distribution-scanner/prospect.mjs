#!/usr/bin/env node
// YN0 Prospect Discovery (internal).
//
//   node internal/distribution-scanner/prospect.mjs <workspace> [options]
//
// Narrows a workspace of candidate repositories down to the few worth a human's
// attention, and says why it dropped each of the rest. Read-only: no network, no
// credentials, no outreach, no edits to the scanned tree. The output is a reading
// list - it decides nothing about who is contacted, and it contacts nobody.
import {readFile, writeFile} from 'node:fs/promises';
import {VALIDATION_AXES} from '../contact-state/lib/model.mjs';
import {loadContactStoreFile} from './lib/contact-link.mjs';
import {loadMetadata} from './lib/metadata.mjs';
import {DEFAULT_PROSPECT_THRESHOLDS, VERDICTS} from './lib/candidates.mjs';
import {DEFAULT_SAMPLES, discover, renderText} from './lib/prospects.mjs';

const USAGE = `YN0 Prospect Discovery (internal)

Usage:
  node internal/distribution-scanner/prospect.mjs <workspace> [options]

Each immediate subdirectory of <workspace> is treated as one candidate repository.

Options:
  --single                 Treat <workspace> itself as one repository
  --contacts <file>        contact-state store to check against (see internal/contact-state).
                           Without it no prospect can be shown as never contacted.
  --metadata <file>        External prospect metadata (${'yn0-prospect-metadata-v1'})
  --asking <axis>          Validation axis this round would ask about
                           (${VALIDATION_AXES.join(' | ')}); holds a candidate whose own
                           matched contacts already owe us that answer
  --verdict <VERDICT>      Report only ${VERDICTS.join(' | ')}
  --format <text|json>     Output format on stdout (default: text)
  --out <file>             Also write the JSON report to <file>
  --samples <n>            Findings shown per prospect (default: ${DEFAULT_SAMPLES})
  --min-completeness <r>   Locale completeness floor (default: ${DEFAULT_PROSPECT_THRESHOLDS.minCompleteness})
  --min-high-confidence <n> High-confidence findings required (default: ${DEFAULT_PROSPECT_THRESHOLDS.minHighConfidence})
  --max-noise-ratio <r>    Citable findings that may be intentional-risk (default: ${DEFAULT_PROSPECT_THRESHOLDS.maxNoiseRatio})
  -h, --help               Show this help

Example:
  node internal/distribution-scanner/prospect.mjs ~/prospects \\
    --contacts internal/contact-state/contacts.local.json \\
    --metadata internal/distribution-scanner/prospects.local.json
`;

const VALUED = {
 '--contacts': 'contacts',
 '--metadata': 'metadata',
 '--format': 'format',
 '--out': 'out',
 '--asking': 'asking',
 '--verdict': 'verdict'
};

const NUMERIC = {
 '--samples': ['samples', Number.parseInt],
 '--min-completeness': ['minCompleteness', Number.parseFloat],
 '--min-high-confidence': ['minHighConfidence', Number.parseInt],
 '--max-noise-ratio': ['maxNoiseRatio', Number.parseFloat]
};

export function parseArgs(argv) {
 const options = {format: 'text', out: null, single: false, contacts: null, metadata: null, asking: null, verdict: null, thresholds: {}};
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
   if (arg === '--verdict' && !VERDICTS.includes(value)) throw new Error('unknown verdict: ' + value);
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
  if (target !== null) throw new Error('only one workspace may be scanned at a time');
  target = arg;
 }
 if (target === null) throw new Error('a path to scan is required');
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
  // A store that was asked for and could not be read is a hard failure, never a
  // silent fall back to "no store" or to an empty one.
  const contacts = options.contacts ? await loadContactStoreFile(options.contacts) : null;
  const metadata = options.metadata ? loadMetadata(await readFile(options.metadata, 'utf8'), options.metadata) : null;
  report = await discover(target, {...options, contacts, metadata});
 } catch (error) {
  process.stderr.write('prospect discovery failed: ' + error.message + '\n');
  return 1;
 }
 if (options.verdict) {
  report = {...report, prospects: report.prospects.filter(prospect => prospect.verdict === options.verdict)};
 }

 const json = JSON.stringify(report, null, 2);
 if (options.out) await writeFile(options.out, json + '\n');
 process.stdout.write((options.format === 'json' ? json : renderText(report)) + '\n');
 return 0;
}

if (import.meta.url === 'file://' + process.argv[1]) process.exitCode = await main(process.argv.slice(2));
