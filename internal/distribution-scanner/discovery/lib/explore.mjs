// Repository discovery: the network half of v3.
//
//   search strategy
//     -> repository discovery
//     -> localization asset discovery   (lib/assets.mjs - the same classifier, offline)
//     -> activity / repository evidence
//     -> materialize locale files
//     == candidate manifest ==            <- the boundary; everything after it is offline
//
// Two boundaries are load-bearing here.
//
// The first is against the scanner core. Nothing under `../../lib/` is allowed to know
// this module exists, and this module never calls into the checker: it classifies remote
// paths with `classifyAsset`, which is a pure function of a string, writes the files it
// decides to keep into a local workspace, and stops. The scan happens later, offline,
// from disk, exactly as it does when a human assembles a workspace by hand.
//
// The second is against people. This module reads repositories: names, file trees, locale
// files, the public flags GitHub returns about a repository. It does not read a profile,
// an email, a contributor list, a follower graph or an issue thread, and it has no way to
// write anything anywhere - see `github.mjs`, whose request function refuses every method
// but GET. `contact_ids` is never filled in here, because "we have never written to them"
// is a claim about the contact store, and only a human who read the store may make it.
import path from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';
import {classifyAsset} from '../../lib/assets.mjs';
import {SCHEMA as MANIFEST_SCHEMA} from '../../lib/manifest.mjs';
import {emptyCounters} from './strategies.mjs';

// How recently something has to have been pushed to count as alive. Round numbers, and a
// judgement: a repository nobody has touched in a year will not answer.
export const ACTIVE_DAYS = 90;
export const MAINTAINED_DAYS = 365;

// Locale files above this are not localization data we can use; skipping them keeps one
// generated file from eating the byte budget.
export const MAX_FILE_BYTES = 256 * 1024;

const DAY = 24 * 60 * 60 * 1000;

// A directory name that is safe, stable and readable, derived from the repository's own
// full name. `owner__repo` round-trips by eye, which matters when a human is reading a
// queue entry and wants to find the files.
export const candidateId = fullName => String(fullName).toLowerCase().replace(/[^a-z0-9._-]+/g, '__');

// Returns the manifest's own field names, so the result spreads straight into a candidate
// entry and a typo becomes a schema error rather than a silently dropped justification.
export function activityOf(pushedAt, asOf) {
 const verdict = (activity, activity_evidence) => ({activity, activity_evidence});
 if (!pushedAt) return verdict('UNKNOWN', 'the repository reports no last-push time');
 const age = (Date.parse(asOf) - Date.parse(pushedAt)) / DAY;
 if (!Number.isFinite(age)) return verdict('UNKNOWN', 'the repository reports no usable last-push time');
 const days = Math.max(0, Math.round(age));
 const seen = 'last push ' + days + ' day(s) before ' + asOf;
 if (days <= ACTIVE_DAYS) return verdict('ACTIVE', seen);
 if (days <= MAINTAINED_DAYS) return verdict('MAINTAINED', seen);
 return verdict('DORMANT', seen);
}

export function contactRouteOf(repository) {
 if (repository.archived) {
  return {public_contact_route: 'NONE', contact_route_evidence: 'the repository is archived; issues are closed'};
 }
 if (repository.hasIssues) {
  return {public_contact_route: 'GITHUB_ISSUE', contact_route_evidence: 'issues are enabled on the repository'};
 }
 return {public_contact_route: 'UNKNOWN', contact_route_evidence: 'issues are disabled; no other public route was checked'};
}

const WORKFLOW_LOCALIZATION = /(i18n|l10n|local[ie]s|locale|localization|localisation|translat)/i;

// The only two signals a machine is allowed to assert, and both are about files it read.
//
// Everything payer-relevant - a rate card, a studio page, a shipped commercial title,
// hands-on LQA - needs a human to have looked at a public page and quoted it. That is not
// a gap to close later: inferring "this party sells localization" from repository shape
// would be exactly the guess about a stranger this engine is built not to make.
export function machineSignals(repository, assets, workflowPaths) {
 const signals = [];
 const blob = filePath => repository.url + '/blob/' + repository.defaultBranch + '/' + filePath;
 if (assets.length) {
  signals.push({
   signal: 'HANDLES_LOCALIZATION_FILES',
   source: blob(assets[0].path),
   observed: assets.length + ' localization file(s) are committed in this repository, e.g. ' + assets[0].path
  });
 }
 const workflow = workflowPaths.find(item => WORKFLOW_LOCALIZATION.test(item));
 if (workflow) {
  signals.push({
   signal: 'CI_LOCALIZATION_STEP',
   source: blob(workflow),
   observed: 'a checked-in CI workflow file is named for localization: ' + workflow
  });
 }
 return signals;
}

// A default writer. Injected in tests so no test touches the filesystem outside its own
// temporary directory, and so the explorer can be run with `--plan` and write nothing.
export const fileWriter = workspace => ({
 async write(relPath, text) {
  const target = path.join(workspace, relPath);
  await mkdir(path.dirname(target), {recursive: true});
  await writeFile(target, text);
 }
});

// Phase 1: run every enabled strategy and collect the repositories they return.
//
// Search first, inspect second, so that a repository found by three strategies is fetched
// once and attributed to all three. Budget is spent in strategy id order, which makes
// "which strategies got to run before the budget ran out" a reproducible fact.
async function search(client, strategies, budget, log) {
 const found = new Map();
 const counters = new Map(strategies.map(strategy => [strategy.strategy_id, emptyCounters(strategy)]));

 for (const strategy of strategies) {
  const row = counters.get(strategy.strategy_id);
  if (!strategy.enabled) continue;
  // The page cap is per strategy, so the first strategy in the run cannot spend every
  // other strategy's pages and make them look barren.
  for (let page = 1; page <= budget.limits.pages && !budget.exhausted; page++) {
   if (!budget.spend('requests')) break;
   budget.record('pages');
   let result;
   try {
    result = await client.searchRepositories(strategy.query, {page, perPage: strategy.per_page});
   } catch (error) {
    // A failed search must not take the run down with it: the strategy is marked, the
    // budget records why, and the manifest still describes everything found so far.
    row.truncated = true;
    row.truncated_reason = 'search failed: ' + error.message;
    if (error.rateLimited) budget.halt('GitHub rate limit reached');
    log.push(strategy.strategy_id + ': search failed on page ' + page + ' - ' + error.message);
    break;
   }
   if (result.remaining === 0) budget.halt('GitHub reports no remaining rate-limit quota');
   for (const repository of result.repositories) {
    if (!budget.spend('repositories')) {
     row.truncated = true;
     row.truncated_reason = budget.reason;
     break;
    }
    row.discovered_count++;
    const id = candidateId(repository.fullName);
    if (!found.has(id)) found.set(id, {repository, strategyIds: new Set()});
    found.get(id).strategyIds.add(strategy.strategy_id);
   }
   if (result.repositories.length < strategy.per_page) break;
  }
  if (budget.truncated && !row.truncated_reason) {
   row.truncated = true;
   row.truncated_reason = budget.reason;
  }
 }
 return {found, counters};
}

// Phase 2: inspect each repository once and materialize the locale files worth scanning.
async function inspect(client, found, counters, budget, writer, asOf, log) {
 const candidates = new Map();
 const bump = (strategyIds, key) => {
  for (const id of strategyIds) {
   const row = counters.get(id);
   if (row) row[key]++;
  }
 };

 for (const id of [...found.keys()].sort()) {
  const {repository, strategyIds} = found.get(id);

  // A fork is somebody else's work, and an archived repository has no route in. Both are
  // dropped before an inspection is spent on them.
  if (repository.fork || repository.archived) {
   bump(strategyIds, 'skipped_count');
   continue;
  }
  if (budget.exhausted || !budget.spend('inspections') || !budget.spend('requests')) {
   bump(strategyIds, 'skipped_count');
   continue;
  }

  let tree;
  try {
   tree = await client.listTree(repository.fullName, repository.defaultBranch);
  } catch (error) {
   bump(strategyIds, 'skipped_count');
   if (error.rateLimited) budget.halt('GitHub rate limit reached');
   log.push(repository.fullName + ': tree listing failed - ' + error.message);
   continue;
  }
  if (tree.remaining === 0) budget.halt('GitHub reports no remaining rate-limit quota');
  bump(strategyIds, 'inspected_count');

  // The same classifier the offline inventory uses, applied to remote paths. It is a pure
  // function of a string, which is why this is allowed to live on the network side.
  const assets = tree.paths
   .map(item => ({...item, asset: classifyAsset(item.path)}))
   .filter(item => item.asset)
   .map(item => ({...item.asset, size: item.size}));
  const languages = [...new Set(assets.map(asset => asset.language).filter(Boolean))].sort();

  if (assets.length) bump(strategyIds, 'localization_asset_count');
  if (!languages.includes('ja')) continue;
  bump(strategyIds, 'ja_locale_count');

  // Only repositories with a Japanese asset are pulled down. Everything else is a
  // repository the checker has nothing to say about, and a download spent for nothing.
  const written = [];
  let truncated = tree.truncated;
  for (const asset of assets) {
   if (asset.size > MAX_FILE_BYTES) {
    truncated = true;
    continue;
   }
   if (!budget.spend('files') || !budget.spend('bytes', asset.size) || !budget.spend('requests')) {
    truncated = true;
    break;
   }
   try {
    const {text, remaining} = await client.getFile(repository.fullName, repository.defaultBranch, asset.path);
    if (remaining === 0) budget.halt('GitHub reports no remaining rate-limit quota');
    await writer.write(path.join(id, asset.path), text);
    written.push(asset.path);
   } catch (error) {
    truncated = true;
    log.push(repository.fullName + ': could not read ' + asset.path + ' - ' + error.message);
   }
  }
  if (!written.length) continue;

  if (!budget.spend('candidates')) {
   log.push('candidate budget exhausted before ' + repository.fullName);
   break;
  }
  bump(strategyIds, 'materialized_count');

  const workflows = tree.paths.map(item => item.path).filter(item => item.startsWith('.github/workflows/'));
  candidates.set(id, {
   strategy_ids: [...strategyIds].sort(),
   owner: repository.owner,
   repository: repository.fullName,
   url: repository.url,
   path: id,
   aliases: [...new Set([repository.owner, repository.name, repository.fullName].filter(Boolean))].sort(),
   ...activityOf(repository.pushedAt, asOf),
   ...contactRouteOf(repository),
   // Never filled in here. `undefined` means nobody checked the contact store, which is
   // the truth, and which keeps this candidate out of READY_FOR_REVIEW until someone has.
   signals: machineSignals(repository, assets, workflows),
   // Absent, not null: an optional field the explorer has nothing for is left out, so the
   // manifest never carries a `null` where a human would expect something somebody wrote.
   ...(repository.description ? {notes: 'repository description: ' + repository.description} : {}),
   discovery: {
    tree_file_count: tree.paths.length,
    localization_asset_count: assets.length,
    languages,
    materialized_file_count: written.length,
    truncated
   }
  });
 }
 return candidates;
}

// Run the whole exploration and return a manifest, in the shape `lib/manifest.mjs` parses.
//
// `asOf` is an explicit instant rather than a clock read: it is what "active" is measured
// against, it is recorded in the manifest, and passing it in is what makes a run
// reproducible against a recorded fixture.
export async function explore({client, strategies, budget, writer, asOf, log = []}) {
 const {found, counters} = await search(client, strategies, budget, log);
 const candidates = await inspect(client, found, counters, budget, writer, asOf, log);

 for (const row of counters.values()) {
  if (budget.truncated && !row.truncated_reason) {
   row.truncated = true;
   row.truncated_reason = budget.reason;
  }
 }

 return {
  manifest: {
   schema: MANIFEST_SCHEMA,
   as_of: asOf,
   budget: budget.snapshot(),
   strategies: [...counters.values()].sort((a, b) => (a.strategy_id < b.strategy_id ? -1 : 1)),
   candidates: Object.fromEntries([...candidates.keys()].sort().map(id => [id, candidates.get(id)]))
  },
  log,
  discoveredCount: found.size
 };
}
