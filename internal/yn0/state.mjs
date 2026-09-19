#!/usr/bin/env node
// YN0 validation state (internal).
//
//   node internal/yn0/state.mjs [options]
//
// Reads internal/yn0/contacts.json, validates it against the YN0 state model, and
// prints each contact's stored conversation/validation state next to its derived
// state and next_action.
//
// Read-only by construction: it never writes the store, sends nothing, opens no
// issue, makes no network call and holds no credentials. It is a lens on the SSOT.
import {loadStore, renderText, report, STORE_PATH} from './lib/store.mjs';

const USAGE = `YN0 validation state (internal)

Usage:
  node internal/yn0/state.mjs [options]

Options:
  --format <text|json>   Output format on stdout (default: text)
  --file <path>          Contact store to read (default: internal/yn0/contacts.json)
  --check                Validate the store and print nothing on success
  -h, --help             Show this help
`;

export function parseArgs(argv) {
 const options = {format: 'text', file: STORE_PATH, check: false};
 for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '-h' || arg === '--help') return {help: true};
  if (arg === '--check') {
   options.check = true;
   continue;
  }
  if (arg === '--format' || arg === '--file') {
   const value = argv[++i];
   if (value === undefined) throw new Error('missing value for ' + arg);
   if (arg === '--format' && value !== 'text' && value !== 'json') throw new Error('unknown format: ' + value);
   options[arg.slice(2)] = value;
   continue;
  }
  throw new Error('unknown option: ' + arg);
 }
 return options;
}

async function main(argv) {
 let options;
 try {
  options = parseArgs(argv);
 } catch (error) {
  process.stderr.write(String(error.message) + '\n\n' + USAGE);
  return 2;
 }
 if (options.help) {
  process.stdout.write(USAGE);
  return 0;
 }
 let store;
 try {
  store = await loadStore(options.file);
 } catch (error) {
  process.stderr.write(String(error.message) + '\n');
  return 1;
 }
 if (options.check) return 0;
 process.stdout.write(options.format === 'json' ? JSON.stringify(report(store), null, 2) + '\n' : renderText(store));
 return 0;
}

if (import.meta.url === 'file://' + process.argv[1]) process.exitCode = await main(process.argv.slice(2));
