// Localization asset inventory for the YN0 Prospect Discovery layer.
//
// The scanner's `discover.mjs` answers a narrow question - "which EN/JA pairs can the
// checker actually read?" - and deliberately ignores everything else. That is the right
// answer for the checker and the wrong one for prospect discovery: a repository whose
// only Japanese lives in `locale/ja.po` is not a repository without localization, it is
// a repository we cannot check yet.
//
// So this module answers the wider question - "what localization assets exist here at
// all?" - and marks each format either SUPPORTED (a registered file adapter claims the
// extension) or DETECTED_BUT_UNSUPPORTED (we can see it, we cannot parse it).
//
// DETECTED_BUT_UNSUPPORTED is a terminal state on purpose. Nothing here parses a PO,
// CSV or YAML file, and nothing here is a step towards doing so: a format earns a
// product adapter when a validation response asks for it, not when the inventory
// notices it exists.
//
// Filesystem only: no network, no credentials, no mutation.
import path from 'node:path';
import {walk} from './discover.mjs';
import {LOCALE_EXTENSIONS} from './adapters/index.mjs';

export const SUPPORT_STATES = ['SUPPORTED', 'DETECTED_BUT_UNSUPPORTED'];

// Extensions that can carry localized strings. `inherent: true` means the extension
// exists for localization and nothing else, so its presence is evidence on its own;
// the rest are general-purpose formats that only count with locale evidence in the path.
export const LOCALE_FORMATS = {
 '.json':        {format: 'json',       label: 'JSON',              inherent: false},
 '.csv':         {format: 'csv',        label: 'CSV',               inherent: false},
 '.tsv':         {format: 'tsv',        label: 'TSV',               inherent: false},
 '.yaml':        {format: 'yaml',       label: 'YAML',              inherent: false},
 '.yml':         {format: 'yaml',       label: 'YAML',              inherent: false},
 '.xml':         {format: 'xml',        label: 'XML',               inherent: false},
 '.ini':         {format: 'ini',        label: 'INI',               inherent: false},
 '.txt':         {format: 'txt',        label: 'Plain text',        inherent: false},
 '.properties':  {format: 'properties', label: 'Java properties',   inherent: false},
 '.po':          {format: 'po',         label: 'Gettext PO',        inherent: true},
 '.pot':         {format: 'po',         label: 'Gettext PO',        inherent: true},
 '.xliff':       {format: 'xliff',      label: 'XLIFF',             inherent: true},
 '.xlf':         {format: 'xliff',      label: 'XLIFF',             inherent: true},
 '.arb':         {format: 'arb',        label: 'Flutter ARB',       inherent: true},
 '.ftl':         {format: 'ftl',        label: 'Fluent',            inherent: true},
 '.strings':     {format: 'strings',    label: 'Apple .strings',    inherent: true},
 '.stringsdict': {format: 'strings',    label: 'Apple .strings',    inherent: true},
 '.resx':        {format: 'resx',       label: '.NET resource',     inherent: true}
};

// Directory names that say "the files under here are translations".
export const LOCALE_DIR_HINTS = new Set([
 'i18n', 'l10n', 'intl', 'lang', 'langs', 'language', 'languages',
 'locale', 'locales', 'message', 'messages', 'translation', 'translations'
]);

// Two- and three-letter subtags common enough in real locale trees to be worth
// recognising. An allowlist rather than a pattern, because `/it/`, `/no/` and `/src/`
// are all three letters or fewer and only one of them is a language.
const LANGUAGE_SUBTAGS = new Set([
 'af', 'ar', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en',
 'eo', 'es', 'et', 'eu', 'fa', 'fi', 'fil', 'fr', 'ga', 'gl', 'he', 'hi', 'hr', 'hu',
 'hy', 'id', 'is', 'it', 'iw', 'ja', 'ka', 'kk', 'km', 'kn', 'ko', 'lt', 'lv', 'mk',
 'ml', 'mn', 'mr', 'ms', 'my', 'nb', 'ne', 'nl', 'nn', 'no', 'pa', 'pl', 'pt', 'ro',
 'ru', 'si', 'sk', 'sl', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr', 'uk',
 'ur', 'uz', 'vi', 'zh'
]);

const TAG = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2,4}))?$/;
const SEPARATORS = '-_.';

// `ja`, `ja-JP`, `pt_BR` -> a normalized `lang` / `region`. Anything whose base subtag
// is not a known language is not a language tag, however tag-shaped it looks.
export function languageTag(text) {
 const m = TAG.exec(text);
 if (!m) return null;
 const lang = m[1].toLowerCase();
 if (!LANGUAGE_SUBTAGS.has(lang)) return null;
 return {lang, region: m[2] ? m[2].toLowerCase() : ''};
}

// The language token inside a basename: the whole name, or a `stem SEP tag` /
// `tag SEP stem` split. Mirrors discover.mjs's parseBase, widened past en/ja.
function tagInBase(base) {
 const whole = languageTag(base);
 if (whole) return whole;
 for (let i = 0; i < base.length; i++) {
  if (!SEPARATORS.includes(base[i])) continue;
  const tag = languageTag(base.slice(i + 1));
  if (tag) return tag;
 }
 for (let i = base.length - 1; i > 0; i--) {
  if (!SEPARATORS.includes(base[i])) continue;
  const tag = languageTag(base.slice(0, i));
  if (tag) return tag;
 }
 return null;
}

export const formatOf = ext => LOCALE_FORMATS[String(ext).toLowerCase()] ?? null;

export const supportOf = ext => (LOCALE_EXTENSIONS.has(String(ext).toLowerCase()) ? 'SUPPORTED' : 'DETECTED_BUT_UNSUPPORTED');

// Decide whether one repo-relative path is a localization asset, and say on what
// evidence. Returns null for everything else - including a `.json` that is plainly
// a package manifest, because no part of its path says "locale".
export function classifyAsset(relPath) {
 const segments = relPath.split('/');
 const filename = segments.pop();
 const ext = path.extname(filename);
 const format = formatOf(ext);
 if (!format) return null;

 const asset = (language, evidence) => ({
  path: relPath,
  format: format.format,
  label: format.label,
  support: supportOf(ext),
  language,
  evidence
 });

 const fromName = tagInBase(filename.slice(0, -ext.length));
 const inHintedDir = segments.some(segment => LOCALE_DIR_HINTS.has(segment.toLowerCase()));
 const fromDir = segments.map(segment => tagInBase(segment)).filter(Boolean).pop() ?? null;

 if (fromName) return asset(fromName.lang, 'language tag in the filename');
 if (fromDir && inHintedDir) return asset(fromDir.lang, 'language tag in a locale directory');
 if (format.inherent) return asset(fromDir ? fromDir.lang : null, 'extension exists only for localization');
 if (inHintedDir) return asset(null, 'file sits in a locale directory');
 return null;
}

const bump = (map, key, make) => {
 if (!map.has(key)) map.set(key, make());
 return map.get(key);
};

// Fold a list of classified assets into one per-format summary, sorted for determinism.
export function summarize(assets) {
 const formats = new Map();
 for (const asset of assets) {
  const group = bump(formats, asset.format, () => ({
   format: asset.format,
   label: asset.label,
   support: asset.support,
   fileCount: 0,
   languages: new Set(),
   samplePaths: []
  }));
  group.fileCount++;
  if (asset.language) group.languages.add(asset.language);
  if (group.samplePaths.length < 3) group.samplePaths.push(asset.path);
 }
 const list = [...formats.keys()].sort().map(key => {
  const group = formats.get(key);
  return {...group, languages: [...group.languages].sort()};
 });
 const languages = [...new Set(assets.map(asset => asset.language).filter(Boolean))].sort();
 return {
  assetCount: assets.length,
  formats: list,
  supportedFormats: list.filter(item => item.support === 'SUPPORTED').map(item => item.format),
  unsupportedFormats: list.filter(item => item.support === 'DETECTED_BUT_UNSUPPORTED').map(item => item.format),
  languages,
  hasEnglish: languages.includes('en'),
  hasJapanese: languages.includes('ja'),
  // Formats that carry both sides of the pair we care about. A format appearing here
  // with support DETECTED_BUT_UNSUPPORTED is the interesting case: EN/JA exist and the
  // checker cannot read them.
  englishJapaneseFormats: list.filter(item => item.languages.includes('en') && item.languages.includes('ja')).map(item => item.format)
 };
}

// Walk one repository root and inventory every localization asset under it.
export async function inventory(root) {
 return summarize((await walk(root)).map(classifyAsset).filter(Boolean));
}
