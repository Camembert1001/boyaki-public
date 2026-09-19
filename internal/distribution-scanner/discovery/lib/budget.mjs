// Discovery budget.
//
// Exploration is the half of v3 that can run forever, cost money and get an account rate
// limited, so it is not allowed to start without a ceiling. Every request, page, inspected
// repository, materialized file and accepted candidate is counted against a declared
// limit, and when one is reached the explorer stops *cleanly*: it records why it stopped,
// writes the manifest it has, and the run is resumable rather than lost.
//
// "Stop cleanly" is the whole design. A budget that throws loses the work already done,
// and a run that loses its work gets re-run, which spends the budget again. So `spend`
// returns false, callers break out of their loop, and `truncated` explains itself in the
// manifest where the yield report can see it.
// Global ceilings on the whole run. Every one of these is a running total: spending one
// brings the run closer to stopping.
export const LIMITS = ['requests', 'repositories', 'inspections', 'candidates', 'files', 'bytes'];

// Caps that apply to each strategy separately rather than to the run.
//
// `pages` has to be per-strategy or the comparison the yield layer exists for stops
// working: a global page total means the first strategy in the run spends it all and
// every later strategy scores zero for reasons that have nothing to do with the strategy.
// It is still counted - `spent.pages` is the run's total - but counted, not capped.
export const PER_STRATEGY_LIMITS = ['pages'];

const ALL_LIMITS = [...LIMITS, ...PER_STRATEGY_LIMITS];

// Small on purpose. A discovery run is supposed to be repeatable and boring; the defaults
// should fit inside an unauthenticated rate limit rather than assume a token.
export const DEFAULT_BUDGET = {
 requests: 200,      // total API calls of any kind
 pages: 2,           // search result pages *per strategy* (see PER_STRATEGY_LIMITS)
 repositories: 200,  // repositories a search may return in total
 inspections: 60,    // repositories whose file tree we list
 candidates: 40,     // repositories that reach the manifest
 files: 400,         // localization files downloaded
 bytes: 8 * 1024 * 1024
};

export class Budget {
 constructor(limits = {}) {
  this.limits = {...DEFAULT_BUDGET, ...limits};
  for (const key of Object.keys(limits)) {
   if (!ALL_LIMITS.includes(key)) throw new Error('unknown budget limit: ' + key);
  }
  for (const key of ALL_LIMITS) {
   const value = this.limits[key];
   if (!Number.isFinite(value) || value < 0) throw new Error('budget.' + key + ' must be a non-negative number');
  }
  this.spent = Object.fromEntries(ALL_LIMITS.map(key => [key, 0]));
  this.stops = [];
 }

 remaining(key) {
  return this.limits[key] - this.spent[key];
 }

 // Try to spend `amount` of one global limit. Returns false, and records the reason once,
 // when the limit would be exceeded - the caller stops, it does not retry.
 spend(key, amount = 1) {
  if (!LIMITS.includes(key)) throw new Error('unknown budget limit: ' + key);
  if (this.spent[key] + amount > this.limits[key]) {
   const reason = key + ' budget exhausted (' + this.spent[key] + '/' + this.limits[key] + ')';
   if (!this.stops.includes(reason)) this.stops.push(reason);
   return false;
  }
  this.spent[key] += amount;
  return true;
 }

 // Count something the run does per strategy. The caller enforces the cap against
 // `limits[key]` for its own strategy; this only keeps the run's total for the report.
 record(key, amount = 1) {
  if (!PER_STRATEGY_LIMITS.includes(key)) throw new Error('not a per-strategy limit: ' + key);
  this.spent[key] += amount;
 }

 // A stop that is not about a limit: a rate limit we were told about, a network failure,
 // an interrupted run. Recorded in the same place so the manifest has one answer to "why
 // does this run look short?".
 halt(reason) {
  if (!this.stops.includes(reason)) this.stops.push(reason);
  this.halted = true;
 }

 get exhausted() {
  return Boolean(this.halted) || LIMITS.some(key => this.spent[key] >= this.limits[key]);
 }

 get truncated() {
  return this.stops.length > 0;
 }

 get reason() {
  return this.stops.length ? this.stops.join('; ') : null;
 }

 snapshot() {
  return {
   limits: {...this.limits},
   spent: {...this.spent},
   truncated: this.truncated,
   reason: this.reason
  };
 }
}
