#!/usr/bin/env node
// YN0 Distribution Scanner (internal MVP).
//
//   node internal/distribution-scanner/scan.mjs <path> [options]
//
// Inspects a local checkout or fixture directory for EN/JA locale pairs, runs the
// JP UI Preflight's mechanical checks, and classifies each pair by prospect fit.
// Read-only: no network, no credentials, no outreach, no edits to the scanned tree.
import {writeFile} from 'node:fs/promises';
import {scan, renderText, DEFAULT_THRESHOLDS, DEFAULT_SAMPLES} from './lib/scanner.mjs';

const USAGE = `YN0 Distribution Scanner (internal)

Usage:
  node internal/distribution-scanner/scan.mjs <path> [options]

Options:
  --format <text|json>     Output format on stdout (default: text)
  --out <file>             Also write the JSON report to <file>
  --samples <n>            Sample findings per pair (default: ${DEFAULT_SAMPLES})
  --high-fit-max <n>       Max findings still counted HIGH_FIT (default: ${DEFAULT_THRESHOLDS.highFitMax})
  --review-max <n>         Max findings still counted REVIEW (default: ${DEFAULT_THRESHOLDS.reviewMax})
  --noisy-blank-ratio <r>  Untranslated share that forces TOO_NOISY (default: ${DEFAULT_THRESHOLDS.noisyBlankRatio})
  -h, --help               Show this help

Example:
  node internal/distribution-scanner/scan.mjs internal/distribution-scanner/fixtures
`;

const NUMERIC = {
 '--samples': ['samples', Number.parseInt],
 '--high-fit-max': ['highFitMax', Number.parseInt],
 '--review-max': ['reviewMax', Number.parseInt],
 '--noisy-blank-ratio': ['noisyBlankRatio', Number.parseFloat]
};

export function parseArgs(argv) {
 const options = {format: 'text', out: null, thresholds: {}};
 let target = null;
 for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '-h' || arg === '--help') return {help: true};
  if (arg === '--format' || arg === '--out') {
   const value = argv[++i];
   if (value === undefined) throw new Error('missing value for ' + arg);
   if (arg === '--format' && value !== 'text' && value !== 'json') throw new Error('unknown format: ' + value);
   options[arg.slice(2)] = value;
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
  if (target !== null) throw new Error('only one path may be scanned at a time');
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
  report = await scan(target, options);
 } catch (error) {
  process.stderr.write('scan failed: ' + error.message + '\n');
  return 1;
 }
 const json = JSON.stringify(report, null, 2);
 if (options.out) await writeFile(options.out, json + '\n');
 process.stdout.write((options.format === 'json' ? json : renderText(report)) + '\n');
 return 0;
}

if (import.meta.url === 'file://' + process.argv[1]) process.exitCode = await main(process.argv.slice(2));
