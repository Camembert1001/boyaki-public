// Search strategies: the explicit, comparable routes exploration takes.
//
// A discovery engine with one hard-coded query is a discovery engine you cannot learn
// anything from. The point of naming each route and counting it separately is the
// question in section 4 of the brief: *which* way of looking produces candidates worth a
// person's time? A strategy returning 500 repositories and two useful candidates is worse
// than one returning 80 and four, and only per-strategy counters can say so.
//
// So a strategy is a first-class record with an id, a source, a query, and the counters
// the manifest carries back. The default set in `strategies.json` is a starting guess and
// is explicitly not the right answer - it is a file precisely so that replacing a route
// that yields nothing is an edit, not a patch.
//
// Nothing here executes anything. This module is the model and the loader; `github.mjs`
// runs a query and `explore.mjs` decides what to do with the results.
export const SCHEMA = 'yn0-search-strategies-v1';

// Where a strategy looks. Only one source is implemented, and adding another means adding
// a client, not changing the model.
export const SOURCES = ['github_search_repositories'];

// How a strategy asks the search to rank what it returns. `null` is GitHub's own
// relevance ranking ("best match") and is the default, because it is the only ranking that
// has anything to do with the query.
//
// v3 hard-coded `updated` in the client, which is a ranking by *churn*: it promotes
// whatever was pushed most recently, and the repositories pushed most recently on a broad
// text query are the ones a robot pushes - auto-regenerated awesome lists, star-list
// mirrors, SEO landing repositories. Calibration measured the difference and it is not
// close, so the ranking is now a property of the strategy, declared where the query is,
// and comparable like everything else here.
export const SORTS = [null, 'updated', 'stars', 'forks', 'help-wanted-issues'];
export const ORDERS = ['asc', 'desc'];

export class StrategyError extends Error {}

const fail = message => {
 throw new StrategyError(message);
};

const assertText = (value, label) => {
 if (typeof value !== 'string' || value.trim() === '') fail(label + ' must be a non-empty string');
 return value;
};

export function normalizeStrategy(raw, label) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must be an object');
 const source = raw.source ?? 'github_search_repositories';
 if (!SOURCES.includes(source)) fail(label + '.source must be one of ' + SOURCES.join(', '));
 const perPage = raw.per_page ?? 30;
 if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) fail(label + '.per_page must be an integer in 1..100');
 const sort = raw.sort === undefined ? null : raw.sort;
 if (!SORTS.includes(sort)) {
  fail(label + '.sort must be one of ' + SORTS.map(item => JSON.stringify(item)).join(', '));
 }
 const order = raw.order ?? 'desc';
 if (!ORDERS.includes(order)) fail(label + '.order must be one of ' + ORDERS.join(', '));
 return {
  strategy_id: assertText(raw.strategy_id, label + '.strategy_id'),
  source,
  query: assertText(raw.query, label + '.query'),
  per_page: perPage,
  // null means "let the search rank by relevance"; see SORTS.
  sort,
  order,
  // Free text for the human reading the yield table: why this route was thought worth
  // trying at all. It is documentation, not a filter.
  rationale: raw.rationale === undefined || raw.rationale === null ? null : String(raw.rationale),
  enabled: raw.enabled === undefined ? true : Boolean(raw.enabled)
 };
}

export function loadStrategies(text, label = 'strategies') {
 let parsed;
 try {
  parsed = JSON.parse(text);
 } catch (error) {
  fail(label + ' is not valid JSON: ' + error.message);
 }
 if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(label + ' must be a JSON object');
 if (parsed.schema !== undefined && parsed.schema !== SCHEMA) {
  fail(label + ' has schema ' + JSON.stringify(parsed.schema) + ', expected ' + SCHEMA);
 }
 if (!Array.isArray(parsed.strategies)) fail(label + ' must carry a "strategies" array');
 const strategies = parsed.strategies.map((item, index) => normalizeStrategy(item, label + '.strategies[' + index + ']'));
 const seen = new Set();
 for (const strategy of strategies) {
  if (seen.has(strategy.strategy_id)) fail(label + ' declares ' + strategy.strategy_id + ' twice');
  seen.add(strategy.strategy_id);
 }
 // Sorted by id so a run is deterministic in the order it spends its budget: with a small
 // budget, *which* strategies got to run is part of the result.
 return strategies.sort((a, b) => (a.strategy_id < b.strategy_id ? -1 : 1));
}

// The counters one strategy contributes to the manifest. Everything downstream of
// `materialized_count` is recomputed by the review pass from the files on disk; these are
// the numbers only the explorer can know, because they count what it threw away.
export const emptyCounters = strategy => ({
 strategy_id: strategy.strategy_id,
 source: strategy.source,
 query: strategy.query,
 // Carried into the manifest because a result set is not reproducible from its query
 // alone: the same query ranked two ways is two different first pages.
 sort: strategy.sort ?? null,
 order: strategy.order ?? 'desc',
 discovered_count: 0,           // repositories the search returned
 inspected_count: 0,            // repositories whose file tree we listed
 localization_asset_count: 0,   // of those, ones with localization assets at all
 ja_locale_count: 0,            // of those, ones with a Japanese asset
 materialized_count: 0,         // of those, ones whose files we pulled down to scan
 skipped_count: 0,              // dropped before inspection (fork, archived, no tree, ...)
 truncated: false,
 truncated_reason: null
});
