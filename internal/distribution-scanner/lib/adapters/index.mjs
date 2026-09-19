// File adapter registry for the YN0 Distribution Scanner.
//
// Adding a format means adding one module beside this one and one entry to ADAPTERS
// (plus a conformance fixture in tests/adapter-fixtures.mjs). Nothing in checks.mjs,
// discover.mjs or scanner.mjs changes: discovery reads its extension list from here,
// and the checker only ever sees normalized entries.
//
// Adapter contract:
//
//   id          short lowercase identifier, unique across adapters
//   label       human-readable format name, used in report diagnostics
//   extensions  lowercase extensions (with the dot) this adapter owns, each claimed by
//               exactly one adapter. Discovery ignores every other file, so an
//               unregistered extension is invisible to the scanner.
//   parse(text) -> {ok: true, entries: NormalizedEntry[]} | {ok: false, reason: string}
//               Pure: raw text in, normalized entries out. No filesystem, no network,
//               and never throws on malformed input - a bad file returns {ok: false}
//               with a reason the report prints under `skipped`.
import path from 'node:path';
import jsonAdapter from './json.mjs';

export const ADAPTERS = [jsonAdapter];

const byExtension = new Map();
for (const adapter of ADAPTERS) {
 for (const ext of adapter.extensions) {
  if (byExtension.has(ext)) throw new Error('two adapters claim ' + ext + ': ' + byExtension.get(ext).id + ' and ' + adapter.id);
  byExtension.set(ext, adapter);
 }
}

// Extensions discovery will consider at all. Everything else is not a locale file.
export const LOCALE_EXTENSIONS = new Set(byExtension.keys());

export const adapterForExtension = ext => byExtension.get(String(ext).toLowerCase()) ?? null;

export const adapterForPath = relPath => adapterForExtension(path.extname(relPath));
