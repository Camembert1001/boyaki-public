#!/usr/bin/env node
// YN0 contact state (internal).
//
//   node internal/contact-state/state.mjs <contacts.json> [options]
//
// Reads a contact store, folds each contact's event log into conversation state and
// validation state, and prints the derived next action for each one.
//
// Read-only and offline: it sends nothing, opens nothing, and never writes to the
// store it was given. It reports what state a contact is in; a human decides what
// to do about it.
import {readFile, writeFile} from 'node:fs/promises';
import {ContactStateError} from './lib/model.mjs';
import {NEXT_ACTIONS} from './lib/derive.mjs';
import {buildReport, loadStore, renderText} from './lib/store.mjs';

const USAGE = `YN0 contact state (internal)

Usage:
  node internal/contact-state/state.mjs <contacts.json> [options]

Options:
  --format <text|json>   Output format on stdout (default: text)
  --out <file>           Also write the JSON report to <file>
  --id <id>              Report only this contact
  --action <ACTION>      Report only contacts whose next_action is ACTION
                         (${NEXT_ACTIONS.join(', ')})
  --attention            Report only contacts with needs_attention
  --strict               Exit 1 if any reported contact has an inconsistency
  -h, --help             Show this help

Example:
  node internal/contact-state/state.mjs internal/contact-state/fixtures/contacts.json
`;

export function parseArgs(argv) {
 const options = {format: 'text', out: null, id: null, action: null, attention: false, strict: false};
 let target = null;
 for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '-h' || arg === '--help') return {help: true};
  if (arg === '--attention') {
   options.attention = true;
   continue;
  }
  if (arg === '--strict') {
   options.strict = true;
   continue;
  }
  if (arg === '--format' || arg === '--out' || arg === '--id' || arg === '--action') {
   const value = argv[++i];
   if (value === undefined) throw new Error('missing value for ' + arg);
   if (arg === '--format' && value !== 'text' && value !== 'json') throw new Error('unknown format: ' + value);
   if (arg === '--action' && !NEXT_ACTIONS.includes(value)) throw new Error('unknown action: ' + value);
   options[arg.slice(2)] = value;
   continue;
  }
  if (arg.startsWith('-')) throw new Error('unknown option: ' + arg);
  if (target !== null) throw new Error('only one store may be read at a time');
  target = arg;
 }
 if (target === null) throw new Error('a contact store path is required');
 return {help: false, target, options};
}

export function filterReport(report, options) {
 const contacts = report.contacts.filter(contact =>
  (options.id === null || contact.id === options.id) &&
  (options.action === null || contact.derived.next_action === options.action) &&
  (!options.attention || contact.derived.needs_attention));
 const summary = Object.fromEntries(NEXT_ACTIONS.map(action => [action, 0]));
 for (const contact of contacts) summary[contact.derived.next_action]++;
 return {
  ...report,
  contactCount: contacts.length,
  summary,
  needsAttention: contacts.filter(contact => contact.derived.needs_attention).map(contact => contact.id),
  contacts
 };
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
  report = filterReport(buildReport(loadStore(await readFile(target, 'utf8'), target)), options);
 } catch (error) {
  process.stderr.write((error instanceof ContactStateError ? 'invalid store: ' : 'failed to read store: ') + error.message + '\n');
  return 1;
 }
 const json = JSON.stringify(report, null, 2);
 process.stdout.write(options.format === 'json' ? json + '\n' : renderText(report, target));
 if (options.out) await writeFile(options.out, json + '\n');
 if (options.strict && report.contacts.some(contact => contact.derived.inconsistencies.length > 0)) return 1;
 return 0;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
 process.exitCode = await main(process.argv.slice(2));
}
