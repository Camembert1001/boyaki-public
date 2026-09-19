// Exploration yield: which search strategy is actually worth running again?
//
// The number a discovery engine invites you to optimise is "repositories found", and it
// is the wrong one. A strategy that returns 500 repositories and two useful candidates is
// worse than one that returns 80 and four - it costs more machine time, more API budget
// and more of the reviewer's patience for the same result. So the unit here is the
// conversion between funnel stages, per strategy, and the counts are reported beside every
// rate because a rate computed from four samples is not a measurement.
//
// Deliberately arithmetic. No model, no optimiser, no strategy that turns itself off: the
// point is to let a person compare search routes and decide, and a self-tuning explorer
// would be a second opinion nobody asked for. Zero denominators produce `null`, never a
// NaN and never a 0 that reads like a measured zero.
export const STAGES = [
 'discovered',           // the search returned it
 'inspected',            // we looked at its file tree
 'localizationAssets',   // it has localization assets of some format
 'japanese',             // one of those assets is Japanese
 'scannable',            // the checker could read an EN/JA pair
 'meaningfulFinding',    // the scan produced a finding beyond "not translated yet"
 'highConfidence',       // at least one finding survives "could this be on purpose?"
 'validationRelevant',   // its public evidence bears on the axis we are asking about
 'humanReview'           // it reached a lane a person reads: READY_FOR_REVIEW or HUMAN_REVIEW
];

// Under this many samples a conversion rate is reported but marked. It is a reading aid,
// not a threshold anything branches on.
export const SMALL_SAMPLE = 20;

// The conversions worth comparing strategies on. Each is [from, to].
export const CONVERSIONS = [
 ['discovered', 'localizationAssets'],
 ['localizationAssets', 'japanese'],
 ['japanese', 'scannable'],
 ['scannable', 'highConfidence'],
 ['highConfidence', 'validationRelevant'],
 ['validationRelevant', 'humanReview'],
 ['discovered', 'humanReview']
];

const round = value => Math.round(value * 10000) / 10000;

// A rate that refuses to lie. `rate: null` means "no denominator", which is a different
// statement from "0% converted" and is displayed differently.
export function conversion(numerator, denominator) {
 return {
  numerator,
  denominator,
  rate: denominator > 0 ? round(numerator / denominator) : null,
  sample: denominator === 0 ? 'NONE' : denominator < SMALL_SAMPLE ? 'SMALL' : 'OK'
 };
}

export const emptyCounts = () => Object.fromEntries(STAGES.map(stage => [stage, 0]));

// How far down the funnel one evaluated candidate got.
//
// A prefix, not a set. The stages are a chain - a candidate that is not scannable cannot
// be past scannable - so the answer is "the longest run of stages it satisfied from the
// top", and a stage satisfied *after* a gap does not count. Without that, a candidate
// whose only findings are typographic but whose public evidence is excellent would be
// counted under `highConfidence` it never had, and every conversion below it would be
// quietly inflated.
//
// The consequence is that the funnel and the lanes measure different things on purpose:
// `humanReview` here means "reached a human by going the whole way", while `lanes` (see
// yieldByStrategy) counts everything a person actually has to read. Both are reported.
export function stagesReached(entry) {
 const {prospect, value, queue} = entry;
 const assets = prospect.assets;
 const evidence = prospect.evidence;
 const satisfied = {
  discovered: true,
  // Everything in a workspace has had its files read, whether a manifest describes it or
  // a human put it there.
  inspected: true,
  localizationAssets: assets.assetCount > 0,
  japanese: assets.hasJapanese,
  scannable: evidence.pairCount > 0,
  meaningfulFinding: evidence.highConfidenceFindings + evidence.intentionalRiskFindings > 0,
  highConfidence: evidence.highConfidenceFindings > 0,
  validationRelevant: value.value === 'HIGH' || value.value === 'MEDIUM',
  humanReview: queue.name === 'READY_FOR_REVIEW' || queue.name === 'HUMAN_REVIEW'
 };
 const stop = STAGES.findIndex(stage => !satisfied[stage]);
 return stop === -1 ? [...STAGES] : STAGES.slice(0, stop);
}

const tally = (counts, stages) => {
 for (const stage of stages) counts[stage]++;
 return counts;
};

// Fold evaluated candidates into one funnel per strategy, plus a total.
//
// A candidate found by two strategies counts for both: the question each row answers is
// "if I ran only this strategy, what would I have got?", and both would have got it.
// `discovered` comes from the manifest where the explorer recorded it, because the
// repositories a strategy looked at and rejected never reach this side of the boundary.
export function yieldByStrategy(entries, manifest) {
 const rows = new Map();
 const row = id => {
  if (!rows.has(id)) {
   const declared = manifest?.strategies.find(item => item.strategy_id === id) ?? null;
   rows.set(id, {
    strategy_id: id,
    source: declared?.source ?? null,
    query: declared?.query ?? null,
    truncated: declared?.truncated ?? false,
    truncated_reason: declared?.truncated_reason ?? null,
    // What the explorer saw, including the repositories it dropped before the manifest.
    explored: declared
     ? {
        discovered: declared.discovered_count,
        inspected: declared.inspected_count,
        localizationAssets: declared.localization_asset_count,
        japanese: declared.ja_locale_count,
        materialized: declared.materialized_count,
        skipped: declared.skipped_count
       }
     : null,
    counts: emptyCounts(),
    lanes: {}
   });
  }
  return rows.get(id);
 };

 for (const entry of entries) {
  const stages = stagesReached(entry);
  const ids = entry.candidate?.strategy_ids?.length ? entry.candidate.strategy_ids : ['(unattributed)'];
  for (const id of ids) {
   const target = row(id);
   tally(target.counts, stages);
   target.lanes[entry.queue.name] = (target.lanes[entry.queue.name] ?? 0) + 1;
  }
 }

 for (const target of rows.values()) {
  // The explorer's own `discovered` is the honest denominator: it counts the repositories
  // this strategy returned, not the few that survived far enough to be evaluated here.
  if (target.explored) target.counts.discovered = Math.max(target.counts.discovered, target.explored.discovered);
  if (target.explored) target.counts.inspected = Math.max(target.counts.inspected, target.explored.inspected);
  target.conversions = Object.fromEntries(CONVERSIONS.map(([from, to]) =>
   [from + '->' + to, conversion(target.counts[to], target.counts[from])]));
 }

 return [...rows.values()].sort((a, b) => (a.strategy_id < b.strategy_id ? -1 : 1));
}

// One funnel over everything, computed the same way so the totals and the rows agree.
export function overallYield(entries, manifest) {
 const counts = emptyCounts();
 for (const entry of entries) tally(counts, stagesReached(entry));
 const declaredDiscovered = (manifest?.strategies ?? []).reduce((sum, item) => sum + item.discovered_count, 0);
 const declaredInspected = (manifest?.strategies ?? []).reduce((sum, item) => sum + item.inspected_count, 0);
 // Strategies overlap, so the sum of their discoveries is an upper bound on distinct
 // repositories. It is still the right denominator for "what did the machine chew
 // through", which is the number this layer is about.
 counts.discovered = Math.max(counts.discovered, declaredDiscovered);
 counts.inspected = Math.max(counts.inspected, declaredInspected);
 return {
  counts,
  conversions: Object.fromEntries(CONVERSIONS.map(([from, to]) =>
   [from + '->' + to, conversion(counts[to], counts[from])]))
 };
}
