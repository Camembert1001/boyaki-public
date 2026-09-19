#!/usr/bin/env node
// YN0 Prospect Discovery v3 - exploration pass (internal).
//
//   node internal/distribution-scanner/discovery/explore.mjs --workspace <dir> --out <manifest>
//
// Runs the search strategies, inspects what they return, writes the localization files
// worth scanning into a local workspace, and emits a candidate manifest. That manifest and
// that workspace are the input to `review.mjs`, which is offline.
//
// This program reads GitHub. It cannot write to it: the client refuses every HTTP method
// but GET, holds no credential of its own, and there is no outreach code path anywhere
// downstream of it. It contacts nobody, and it is not a step towards contacting anybody.
//
// The manifest describes repositories, not people, and belongs in a `*.local.json` file:
// real prospect data is never committed to this repository.
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadManifest, mergeManifests, normalizeManifest, serializeManifest} from '../lib/manifest.mjs';
import {Budget, DEFAULT_BUDGET} from './lib/budget.mjs';
import {createClient, hasCredential} from './lib/github.mjs';
import {loadStrategies} from './lib/strategies.mjs';
import {explore, fileWriter} from './lib/explore.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STRATEGIES = path.join(here, 'strategies.json');

const USAGE = `YN0 Prospect Discovery v3 - exploration pass (internal)

Usage:
  node internal/distribution-scanner/discovery/explore.mjs --workspace <dir> --out <file> [options]

Options:
  --workspace <dir>        Directory the localization files are written into (required)
  --out <file>             Candidate manifest to write (required; use a *.local.json path)
  --strategies <file>      Search strategies (default: discovery/strategies.json)
  --only <id[,id]>         Run only these strategy ids
  --resume <file>          Merge onto an existing manifest instead of starting empty
  --as-of <instant>        Instant "active" is measured against (default: now, ISO 8601 UTC)
  --max-requests <n>       Total API calls          (default: ${DEFAULT_BUDGET.requests})
  --max-pages <n>          Search pages per strategy (default: ${DEFAULT_BUDGET.pages})
  --max-repositories <n>   Search results accepted   (default: ${DEFAULT_BUDGET.repositories})
  --max-inspections <n>    File trees listed         (default: ${DEFAULT_BUDGET.inspections})
  --max-candidates <n>     Candidates written        (default: ${DEFAULT_BUDGET.candidates})
  --max-files <n>          Locale files downloaded   (default: ${DEFAULT_BUDGET.files})
  --plan                   Print the strategies and the budget, make no request
  -h, --help               Show this help

Credentials come from GITHUB_TOKEN or GH_TOKEN in the environment, and from nowhere else.
Without one the run still works, against GitHub's unauthenticated limits.
`;

const VALUED = {
 '--workspace': 'workspace',
 '--out': 'out',
 '--strategies': 'strategies',
 '--only': 'only',
 '--resume': 'resume',
 '--as-of': 'asOf'
};

const NUMERIC = {
 '--max-requests': 'requests',
 '--max-pages': 'pages',
 '--max-repositories': 'repositories',
 '--max-inspections': 'inspections',
 '--max-candidates': 'candidates',
 '--max-files': 'files'
};

export function parseArgs(argv) {
 const options = {workspace: null, out: null, strategies: DEFAULT_STRATEGIES, only: null,
  resume: null, asOf: null, plan: false, limits: {}};
 for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '-h' || arg === '--help') return {help: true};
  if (arg === '--plan') {
   options.plan = true;
   continue;
  }
  if (VALUED[arg]) {
   const value = argv[++i];
   if (value === undefined) throw new Error('missing value for ' + arg);
   options[VALUED[arg]] = value;
   continue;
  }
  if (NUMERIC[arg]) {
   const value = Number.parseInt(argv[++i], 10);
   if (!Number.isInteger(value) || value < 0) throw new Error('invalid value for ' + arg);
   options.limits[NUMERIC[arg]] = value;
   continue;
  }
  throw new Error('unknown option: ' + arg);
 }
 if (!options.plan) {
  if (!options.workspace) throw new Error('--workspace is required');
  if (!options.out) throw new Error('--out is required');
 }
 return {options};
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
 const {options} = parsed;

 try {
  const all = loadStrategies(await readFile(options.strategies, 'utf8'), options.strategies);
  const wanted = options.only ? new Set(options.only.split(',').map(item => item.trim())) : null;
  const strategies = all.filter(strategy => !wanted || wanted.has(strategy.strategy_id));
  if (wanted) {
   for (const id of wanted) {
    if (!all.some(strategy => strategy.strategy_id === id)) throw new Error('unknown strategy id: ' + id);
   }
  }
  const budget = new Budget(options.limits);

  if (options.plan) {
   process.stdout.write('strategies (' + strategies.length + '):\n');
   for (const strategy of strategies) {
    process.stdout.write('  ' + strategy.strategy_id.padEnd(26) + strategy.query + '\n');
   }
   process.stdout.write('budget: ' + JSON.stringify(budget.limits) + '\n');
   process.stdout.write('credential: ' + (hasCredential() ? 'present (from the environment)' : 'absent') + '\n');
   process.stdout.write('No request was made.\n');
   return 0;
  }

  const asOf = options.asOf ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const log = [];
  const result = await explore({
   client: createClient(),
   strategies,
   budget,
   writer: fileWriter(options.workspace),
   asOf,
   log
  });

  let manifest = normalizeManifest(result.manifest, 'explored manifest');
  if (options.resume) {
   manifest = mergeManifests(loadManifest(await readFile(options.resume, 'utf8'), options.resume), manifest);
  }
  await writeFile(options.out, JSON.stringify(serializeManifest(manifest), null, 2) + '\n');

  const spent = budget.snapshot();
  process.stdout.write('explored ' + result.discoveredCount + ' distinct repositor(y/ies) across ' +
   strategies.length + ' strategy/strategies\n');
  process.stdout.write('manifest: ' + manifest.candidates.size + ' candidate(s) -> ' + options.out + '\n');
  process.stdout.write('workspace: ' + options.workspace + '\n');
  process.stdout.write('budget spent: ' + JSON.stringify(spent.spent) + '\n');
  if (spent.truncated) process.stdout.write('truncated: ' + spent.reason + '\n');
  for (const line of log) process.stdout.write('  note: ' + line + '\n');
  process.stdout.write('\nNothing was sent to anyone. Review the manifest with review.mjs.\n');
  return 0;
 } catch (error) {
  process.stderr.write('exploration failed: ' + error.message + '\n');
  return 1;
 }
}

if (import.meta.url === 'file://' + process.argv[1]) process.exitCode = await main(process.argv.slice(2));
