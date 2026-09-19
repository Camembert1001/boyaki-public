// The adapter <-> checker boundary for the YN0 Distribution Scanner.
//
// A *normalized entry* is what every file adapter produces and the only shape the
// mechanical checks ever read:
//
//   {key: string, value: string, location?: unknown}
//
//   key       identifier of the string inside its own file - a dotted JSON path today,
//             a msgid / row id / line label for some future format. Source and target
//             are matched on this value, so an adapter must derive it the same way on
//             both sides of a pair.
//   value     the string itself, already a string.
//   location  optional and adapter-defined: where the entry sits in the raw file
//             (line number, byte offset, row index). Carried through pairing untouched
//             so a line-oriented format can keep it; the JSON adapter sets none and no
//             check reads it yet.
//
// Nothing here knows about files, extensions or parsers.

export const entry = (key, value, location) =>
 location === undefined ? {key, value: String(value)} : {key, value: String(value), location};

// Entries built from a key -> value map, for callers that already hold one.
export const fromMap = map => Object.keys(map).map(key => entry(key, map[key]));

// Distinct keys in an entry list. Duplicate keys collapse, the way a map would.
export const keyCount = entries => new Set(entries.map(item => item.key)).size;

const index = entries => {
 const byKey = new Map();
 for (const item of entries) byKey.set(item.key, item); // later wins, matching map collapse
 return byKey;
};

// Match source and target entries by key into one record per key, key-sorted.
// `source` / `target` are undefined when the key is absent on that side - that
// absence is exactly what the `missing-ja` rule reads.
export function pairEntries(sourceEntries, targetEntries) {
 const source = index(sourceEntries);
 const target = index(targetEntries);
 return [...new Set([...source.keys(), ...target.keys()])].sort().map(key => ({
  key,
  source: source.get(key)?.value,
  target: target.get(key)?.value,
  sourceLocation: source.get(key)?.location,
  targetLocation: target.get(key)?.location
 }));
}
