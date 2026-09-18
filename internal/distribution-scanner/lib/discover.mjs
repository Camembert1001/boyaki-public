// EN/JA locale-pair discovery for the YN0 Distribution Scanner.
// Pure filesystem inspection: no network, no credentials, no mutation.
import {readdir} from 'node:fs/promises';
import path from 'node:path';

// Directories that never hold a project's own locale data worth scanning.
export const SKIP_DIRS = new Set([
 '.git', '.github', '.hg', '.svn', '.idea', '.vscode', '.cache', '.next', '.nuxt',
 'node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'coverage'
]);

// `en`, `ja`, `en-US`, `ja_JP`, `en-Latn` ... the region/script part is optional.
const LANG_TAG = /^(en|ja)(?:[-_]([A-Za-z]{2,4}))?$/i;
const SEPARATORS = '-_.';

const tagOf = text => {
 const m = LANG_TAG.exec(text);
 return m ? {lang: m[1].toLowerCase(), region: m[2] ? m[2].toLowerCase() : ''} : null;
};

// Locate the language token inside a file basename and replace it with `*`, so
// that `strings-en` and `strings-ja` collapse onto the same group key.
function parseBase(base) {
 const whole = tagOf(base);
 if (whole) return {...whole, key: '*'};
 for (let i = 0; i < base.length; i++) { // stem SEP tag, e.g. strings-en-US
  if (!SEPARATORS.includes(base[i])) continue;
  const tag = tagOf(base.slice(i + 1));
  if (tag) return {...tag, key: base.slice(0, i + 1) + '*'};
 }
 for (let i = base.length - 1; i > 0; i--) { // tag SEP stem, e.g. en-US-strings
  if (!SEPARATORS.includes(base[i])) continue;
  const tag = tagOf(base.slice(0, i));
  if (tag) return {...tag, key: '*' + base.slice(i)};
 }
 return null;
}

// Classify one repo-relative JSON path as an EN or JA locale file.
// Filename evidence wins; otherwise the deepest `en`/`ja` directory segment is used.
export function classifyPath(relPath) {
 const segments = relPath.split('/');
 const filename = segments.pop();
 const ext = path.extname(filename);
 if (ext.toLowerCase() !== '.json') return null;
 const base = filename.slice(0, -ext.length);

 const fromName = parseBase(base);
 if (fromName) {
  return {lang: fromName.lang, region: fromName.region, groupKey: [...segments, fromName.key + ext].join('/')};
 }
 for (let i = segments.length - 1; i >= 0; i--) {
  const tag = tagOf(segments[i]);
  if (!tag) continue;
  const key = [...segments.slice(0, i), '*', ...segments.slice(i + 1), filename].join('/');
  return {lang: tag.lang, region: tag.region, groupKey: key};
 }
 return null;
}

// Depth-first walk returning repo-relative POSIX paths, sorted for determinism.
export async function walk(root) {
 const found = [];
 const visit = async rel => {
  const entries = await readdir(path.join(root, rel), {withFileTypes: true});
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
   if (entry.isSymbolicLink()) continue;
   const next = rel ? rel + '/' + entry.name : entry.name;
   if (entry.isDirectory()) {
    if (SKIP_DIRS.has(entry.name)) continue;
    await visit(next);
   } else if (entry.isFile()) {
    found.push(next);
   }
  }
 };
 await visit('');
 return found;
}

// Region-less tags win over regioned ones; ties break on path for determinism.
const preferred = (a, b) => (a.region ? 1 : 0) - (b.region ? 1 : 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// Group locale files by group key and emit one EN/JA pair per group.
export function pairLocaleFiles(relPaths) {
 const groups = new Map();
 for (const relPath of relPaths) {
  const hit = classifyPath(relPath);
  if (!hit) continue;
  if (!groups.has(hit.groupKey)) groups.set(hit.groupKey, {groupKey: hit.groupKey, en: [], ja: []});
  groups.get(hit.groupKey)[hit.lang].push({path: relPath, region: hit.region});
 }
 const pairs = [];
 for (const groupKey of [...groups.keys()].sort()) {
  const group = groups.get(groupKey);
  if (!group.en.length || !group.ja.length) continue;
  const en = group.en.sort(preferred);
  const ja = group.ja.sort(preferred);
  const notes = [];
  if (en.length > 1) notes.push('alternate EN files not scanned: ' + en.slice(1).map(f => f.path).join(', '));
  if (ja.length > 1) notes.push('alternate JA files not scanned: ' + ja.slice(1).map(f => f.path).join(', '));
  pairs.push({groupKey, en: en[0].path, ja: ja[0].path, notes});
 }
 return pairs;
}
