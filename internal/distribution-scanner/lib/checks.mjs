// Mechanical EN/JA checks for the YN0 Distribution Scanner.
//
// Format-agnostic by construction: everything here reads normalized entries
// (see entries.mjs), never a file, an extension or a parse tree. Whatever a file
// adapter produces is checked the same way.
//
// These deliberately mirror the public JP UI Preflight (yn0-jp-ui-preflight/index.html)
// so that a scanner finding is the same claim the public tool would make. The one
// intentional difference: the Preflight's single `placeholder-mismatch` rule is split
// into a set mismatch and a multiplicity-only mismatch, because a natural Japanese
// string may legitimately repeat a placeholder the English string uses once.
//
// The scanner reports. It never rewrites a value.
import {fromMap, pairEntries} from './entries.mjs';

// Identical to the `ph` pattern in yn0-jp-ui-preflight/index.html.
// Covers {{name}}, {name}, {0}, format-like {0:0.#}, %s / %d / %f and indexed %1$s.
export const PLACEHOLDER_PATTERN = /\{\{[^{}]+\}\}|\{[^{}]+\}|%\d+\$[sdf]|%[sdf]/g;
const HALFWIDTH_KATAKANA = /[ｦ-ﾟ]/;
const EDGE_WHITESPACE = /^\s|\s$/;
const IDEOGRAPHIC_SPACE = '　';

export const RULES = {
 'missing-ja': 'ERROR',
 'empty-ja': 'ERROR',
 'placeholder-set-mismatch': 'ERROR',
 'edge-whitespace': 'WARN',
 'halfwidth-katakana': 'WARN',
 'fullwidth-space': 'WARN',
 'placeholder-multiplicity-mismatch': 'INFO'
};

// Findings that mean "this locale is not translated yet" rather than "this string looks wrong".
export const BLANK_RULES = ['missing-ja', 'empty-ja'];

// Findings that are reported in full but do not drive prospect classification, because the
// project may well have written them on purpose. Only edge whitespace qualifies: the issue's
// false-positive discipline calls it out by name, and PocketRoles pads 47 of 1,069 strings
// deliberately for concatenation, which is not 47 reasons to contact its maintainers.
// Half-width katakana and U+3000 stay classifying - those are defect claims, not padding.
export const ADVISORY_RULES = ['edge-whitespace'];

export const SEVERITY_ORDER = {ERROR: 0, WARN: 1, INFO: 2};

export const placeholders = value => [...String(value).matchAll(PLACEHOLDER_PATTERN)].map(m => m[0]).sort();

const tally = tokens => {
 const counts = new Map();
 for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
 return counts;
};

const finding =(rule, key, detail) => ({severity: RULES[rule], rule, key, detail});

// Run every rule for one key. `en` / `ja` are undefined when the key is absent on that side.
export function checkEntry(key, en, ja) {
 const found = [];
 if (ja === undefined) return [finding('missing-ja', key, 'Japanese key is missing.')];
 if (!ja.trim()) found.push(finding('empty-ja', key, 'Japanese value is empty.'));
 if (EDGE_WHITESPACE.test(ja)) found.push(finding('edge-whitespace', key, 'Leading or trailing whitespace. May be intentional for concatenation or layout.'));
 if (HALFWIDTH_KATAKANA.test(ja)) found.push(finding('halfwidth-katakana', key, 'Contains half-width katakana.'));
 if (ja.includes(IDEOGRAPHIC_SPACE)) found.push(finding('fullwidth-space', key, 'Contains IDEOGRAPHIC SPACE U+3000.'));

 if (en !== undefined) {
  const enTokens = placeholders(en);
  const jaTokens = placeholders(ja);
  if (JSON.stringify(enTokens) !== JSON.stringify(jaTokens)) {
   const enOnly = [...new Set(enTokens)].filter(token => !jaTokens.includes(token));
   const jaOnly = [...new Set(jaTokens)].filter(token => !enTokens.includes(token));
   if (enOnly.length || jaOnly.length) {
    const parts = [];
    if (enOnly.length) parts.push('missing in JA: ' + enOnly.join(', '));
    if (jaOnly.length) parts.push('not in EN: ' + jaOnly.join(', '));
    found.push(finding('placeholder-set-mismatch', key, 'Placeholder sets differ (' + parts.join('; ') + ').'));
   } else {
    const enCounts = tally(enTokens);
    const jaCounts = tally(jaTokens);
    const changed = [...enCounts.keys()]
     .filter(token => enCounts.get(token) !== jaCounts.get(token))
     .map(token => token + ' EN x' + enCounts.get(token) + ' / JA x' + jaCounts.get(token));
    found.push(finding('placeholder-multiplicity-mismatch', key,
     'Same placeholder set, different repeat counts (' + changed.join('; ') + '). Natural Japanese may legitimately repeat a placeholder.'));
   }
  }
 }
 return found;
}

// Run every rule over paired entries (see entries.mjs `pairEntries`), whatever file
// adapter produced them. Keys present only in JA are checked on the JA side alone,
// matching the Preflight; they are never reported as extra keys.
export function checkEntries(pairs) {
 const found = [];
 for (const pair of pairs) found.push(...checkEntry(pair.key, pair.source, pair.target));
 return found.sort((a, b) =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
  (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
}

// Convenience for callers holding plain key -> value maps rather than entry lists.
export const checkPair = (enEntries, jaEntries) =>
 checkEntries(pairEntries(fromMap(enEntries), fromMap(jaEntries)));
