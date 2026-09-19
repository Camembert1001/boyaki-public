// The candidate manifest: the boundary between exploration and evaluation.
//
// Everything before this file may use the network, is allowed to be slow, and is allowed
// to produce a different answer tomorrow. Everything after it is offline, deterministic,
// and produces the same verdicts for the same manifest forever. The manifest is where one
// becomes the other, and it is an ordinary local JSON file precisely so that the
// evaluation half can be re-run, diffed and argued with without touching GitHub again.
//
// This module is the *schema*, and it lives on the offline side: parsing a manifest is a
// pure function, and the explorer that writes one imports this rather than defining a
// second shape. Only one module in the tree may describe what a candidate is.
//
// It also does not define a second prospect-metadata model. The fields v2 already reads -
// activity, contact route, aliases, contact ids - are normalized by `metadata.mjs`, and
// `toMetadata()` hands v2 exactly the shape it already takes. v3 adds only what v2 had no
// way to know: which search strategy found this, where it came from, and what public
// evidence was cited about it.
//
// A manifest holds no contact data. It carries no address, no name, no thread reference
// and no contact status - `contact_ids` is a list of ids into contact-state and nothing
// else, and discovery never fills it in, because "we have never written to them" is a
// claim only a human who read the store may make.
import {SCHEMA as METADATA_SCHEMA, normalizeEntry} from './metadata.mjs';
import {normalizeSignals} from './signals.mjs';

export const SCHEMA = 'yn0-candidate-manifest-v1';

// Fields v3 adds on top of a metadata entry.
const DISCOVERY_FIELDS = new Set(['strategy_ids', 'owner', 'repository', 'url', 'path', 'signals', 'discovery']);

const METADATA_FIELDS = new Set([
 'aliases', 'activity', 'activity_evidence', 'public_contact_route', 'contact_route_evidence',
 'contact_ids', 'notes'
]);

export class ManifestError extends Error {}

const fail = message => {
 throw new ManifestError(message);
};

const assertText = (value, label) => {
 if (typeof value !== 'string' || value.trim() === '') fail(label + ' must be a non-empty string');
 return value;
};

const assertStrings = (value, label) => {
 if (!Array.isArray(value)) fail(label + ' must be an array of strings');
 for (const item of value) assertText(item, label + ' entries');
 return [...value];
};

// Counts the explorer observed on its side of the boundary. They are reported, never
// re-derived: the evaluation half recomputes everything it judges from the files on disk.
function normalizeDiscovery(raw, label) {
 if (raw === undefined) return null;
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must be an object');
 const count = (key, fallback = 0) => {
  const value = raw[key] ?? fallback;
  if (!Number.isInteger(value) || value < 0) fail(label + '.' + key + ' must be a non-negative integer');
  return value;
 };
 return {
  tree_file_count: count('tree_file_count'),
  localization_asset_count: count('localization_asset_count'),
  languages: raw.languages === undefined ? [] : assertStrings(raw.languages, label + '.languages').sort(),
  materialized_file_count: count('materialized_file_count'),
  truncated: Boolean(raw.truncated)
 };
}

export function normalizeCandidate(raw, id, label) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must be an object');
 for (const key of Object.keys(raw)) {
  if (!DISCOVERY_FIELDS.has(key) && !METADATA_FIELDS.has(key)) {
   fail(label + ' has unknown field ' + JSON.stringify(key) + '; known fields are ' +
    [...DISCOVERY_FIELDS, ...METADATA_FIELDS].sort().join(', '));
  }
 }
 const metadata = normalizeEntry(
  Object.fromEntries(Object.entries(raw).filter(([key]) => METADATA_FIELDS.has(key))),
  label
 );
 return {
  ...metadata,
  id,
  strategy_ids: raw.strategy_ids === undefined ? [] : assertStrings(raw.strategy_ids, label + '.strategy_ids').sort(),
  owner: raw.owner === undefined || raw.owner === null ? null : assertText(raw.owner, label + '.owner'),
  repository: raw.repository === undefined || raw.repository === null ? null : assertText(raw.repository, label + '.repository'),
  url: raw.url === undefined || raw.url === null ? null : assertText(raw.url, label + '.url'),
  // Where the materialized files sit, relative to the workspace root. Defaults to the id,
  // which is what the explorer names the directory.
  path: raw.path === undefined || raw.path === null ? id : assertText(raw.path, label + '.path'),
  signals: normalizeSignals(raw.signals, label + '.signals'),
  discovery: normalizeDiscovery(raw.discovery, label + '.discovery')
 };
}

// Per-strategy counters as the explorer recorded them. The evaluation half recomputes the
// downstream half of the funnel itself (see yield.mjs) - what it cannot recompute is how
// many repositories a strategy had to look at to produce these candidates, which is
// exactly the number that makes one strategy better than another.
function normalizeStrategy(raw, label) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must be an object');
 const count = key => {
  const value = raw[key] ?? 0;
  if (!Number.isInteger(value) || value < 0) fail(label + '.' + key + ' must be a non-negative integer');
  return value;
 };
 return {
  strategy_id: assertText(raw.strategy_id, label + '.strategy_id'),
  source: raw.source === undefined || raw.source === null ? null : assertText(raw.source, label + '.source'),
  query: raw.query === undefined || raw.query === null ? null : assertText(raw.query, label + '.query'),
  discovered_count: count('discovered_count'),
  inspected_count: count('inspected_count'),
  localization_asset_count: count('localization_asset_count'),
  ja_locale_count: count('ja_locale_count'),
  materialized_count: count('materialized_count'),
  skipped_count: count('skipped_count'),
  truncated: Boolean(raw.truncated),
  truncated_reason: raw.truncated_reason === undefined || raw.truncated_reason === null
   ? null
   : assertText(raw.truncated_reason, label + '.truncated_reason')
 };
}

export function loadManifest(text, label = 'manifest') {
 let parsed;
 try {
  parsed = JSON.parse(text);
 } catch (error) {
  fail(label + ' is not valid JSON: ' + error.message);
 }
 return normalizeManifest(parsed, label);
}

export function normalizeManifest(parsed, label = 'manifest') {
 if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(label + ' must be a JSON object');
 if (parsed.schema !== undefined && parsed.schema !== SCHEMA) {
  fail(label + ' has schema ' + JSON.stringify(parsed.schema) + ', expected ' + SCHEMA);
 }
 const raw = parsed.candidates;
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must carry a "candidates" object');
 const candidates = new Map();
 for (const id of Object.keys(raw).sort()) candidates.set(id, normalizeCandidate(raw[id], id, label + ' candidates.' + id));

 const strategiesRaw = parsed.strategies ?? [];
 if (!Array.isArray(strategiesRaw)) fail(label + '.strategies must be an array');
 const strategies = strategiesRaw
  .map((item, index) => normalizeStrategy(item, label + '.strategies[' + index + ']'))
  .sort((a, b) => (a.strategy_id < b.strategy_id ? -1 : 1));

 return {
  schema: SCHEMA,
  // Recorded so a report can say how old its inputs are. Nothing downstream reads it as a
  // clock, and no verdict depends on it.
  as_of: parsed.as_of === undefined || parsed.as_of === null ? null : String(parsed.as_of),
  budget: parsed.budget ?? null,
  strategies,
  candidates
 };
}

// Hand v2 the metadata shape it already takes. v2 is not modified and does not know a
// manifest exists.
export function toMetadata(manifest) {
 const prospects = new Map();
 for (const [id, candidate] of manifest.candidates) {
  prospects.set(id, {
   aliases: candidate.aliases,
   activity: candidate.activity,
   activity_evidence: candidate.activity_evidence,
   public_contact_route: candidate.public_contact_route,
   contact_route_evidence: candidate.contact_route_evidence,
   contact_ids: candidate.contact_ids,
   notes: candidate.notes
  });
 }
 return {schema: METADATA_SCHEMA, prospects};
}

// Serialize a manifest back to the on-disk shape. Sorted throughout: a re-run that found
// the same repositories produces a byte-identical file, so a diff means something changed
// out there rather than in the ordering.
//
// Absent fields are written as absent, never as `null`. The distinction is load-bearing in
// both directions: `contact_ids: undefined` is "nobody checked the contact store" and must
// not come back as "checked, nothing there", and a `null` in an optional text field would
// re-parse as the string "null" and read like evidence somebody wrote down.
export function serializeManifest(manifest) {
 const OPTIONAL = ['owner', 'repository', 'url', 'activity_evidence', 'contact_route_evidence', 'notes',
  'discovery', 'contact_ids'];
 return {
  schema: SCHEMA,
  as_of: manifest.as_of ?? null,
  budget: manifest.budget ?? null,
  strategies: manifest.strategies,
  candidates: Object.fromEntries([...manifest.candidates.keys()].sort().map(id => {
   const {id: _id, ...rest} = manifest.candidates.get(id);
   for (const field of OPTIONAL) {
    if (rest[field] === null || rest[field] === undefined) delete rest[field];
   }
   return [id, rest];
  }))
 };
}

// Merge a freshly explored manifest onto an earlier one, so an interrupted or
// rate-limited run can be resumed instead of restarted. The new run wins on every field
// it observed; candidates only the old run saw are kept, with their strategy ids unioned.
export function mergeManifests(previous, next) {
 const candidates = new Map(previous.candidates);
 for (const [id, candidate] of next.candidates) {
  const old = candidates.get(id);
  candidates.set(id, old
   ? {...candidate, strategy_ids: [...new Set([...old.strategy_ids, ...candidate.strategy_ids])].sort()}
   : candidate);
 }
 const strategies = new Map(previous.strategies.map(item => [item.strategy_id, item]));
 for (const item of next.strategies) strategies.set(item.strategy_id, item);
 return {
  schema: SCHEMA,
  as_of: next.as_of ?? previous.as_of,
  budget: next.budget ?? previous.budget,
  strategies: [...strategies.values()].sort((a, b) => (a.strategy_id < b.strategy_id ? -1 : 1)),
  candidates: new Map([...candidates.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
 };
}
