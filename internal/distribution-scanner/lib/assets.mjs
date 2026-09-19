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
import {isSkippedPath, walk} from './discover.mjs';
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

// Words that say "translations" wherever they appear in a path - in a directory name that
// is not exactly a locale directory (`03-ui-strings_en-ja/`), or in the part of a filename
// left over once the language tag is taken out (`relic_translations_ja.json`).
//
// Everything in LOCALE_DIR_HINTS counts, plus the words that usually name a file. Kept
// narrow on purpose: `text`, `resources` and `data` name as many things that are not
// translations as things that are, and this set only ever admits a language tag that was
// already found - it never makes a path an asset on its own.
export const LOCALE_WORD_HINTS = new Set([
 ...LOCALE_DIR_HINTS,
 'string', 'strings', 'localization', 'localisation', 'localize', 'localise',
 'localized', 'localised', 'loc', 'dict', 'dicts', 'dictionary', 'dictionaries',
 'glossary', 'glossaries', 'caption', 'captions', 'subtitle', 'subtitles'
]);

// `03-ui-strings_en-ja` -> ['03', 'ui', 'strings', 'en', 'ja']. A token match rather than a
// whole-segment match, because real trees write `ui_strings`, `relic_translations` and
// `chnlocalplus/localisation` far more often than they write a bare `locales`.
const saysLocale = text => text.toLowerCase().split(/[^a-z0-9]+/).some(token => LOCALE_WORD_HINTS.has(token));

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
//
// `stem` is what was left over, normalized, and `null` when the whole basename was the
// tag. The caller needs it because the two cases are not equally strong evidence: a file
// *called* `ja` is a locale file by convention, while a tag that merely falls out of a
// longer name is a coincidence until something else in the path agrees.
function tagInBase(base) {
 const stemOf = text => text.replace(/^[-_.]+|[-_.]+$/g, '').toLowerCase();
 const whole = languageTag(base);
 if (whole) return {...whole, stem: null};
 for (let i = 0; i < base.length; i++) {
  if (!SEPARATORS.includes(base[i])) continue;
  const tag = languageTag(base.slice(i + 1));
  if (tag) return {...tag, stem: stemOf(base.slice(0, i))};
 }
 for (let i = base.length - 1; i > 0; i--) {
  if (!SEPARATORS.includes(base[i])) continue;
  const tag = languageTag(base.slice(0, i));
  if (tag) return {...tag, stem: stemOf(base.slice(i))};
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

 // A language tag carved out of a longer filename is only evidence when something else in
 // the path says "localization": a word in one of the directories above it, a word in the
 // rest of the filename, or an extension that exists for nothing else. Without that rule
 // `nightly-windows-ms.yml` is Malay, `oh-my-dsh.yml` is Burmese and
 // `Mr-potato-123__dsh-mcp.yml` is Marathi - three well-formed tags and three files that
 // have nothing to do with locale data. A basename that is *entirely* a language tag
 // (`ja.json`) is the convention itself and still stands alone.
 const namedForLocale = fromName && (
  fromName.stem === null ||
  format.inherent ||
  saysLocale(fromName.stem) ||
  segments.some(saysLocale)
 );

 if (namedForLocale) return asset(fromName.lang, 'language tag in the filename');
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

// The inventory rule applied to a list of repo-relative paths, and the only place that
// decides what counts. Both halves of v3 call it - `inventory()` below with paths walked
// off a disk, `discovery/lib/explore.mjs` with paths GitHub listed - so the same
// repository yields the same asset inventory whichever side looked at it. Previously the
// skip list existed only on the offline side, and a remote run counted `.github/`,
// `node_modules/` and `dist/` as localization assets that an offline run of the same
// repository never saw.
export const classifyPaths = relPaths =>
 relPaths.filter(relPath => !isSkippedPath(relPath)).map(classifyAsset).filter(Boolean);

// Walk one repository root and inventory every localization asset under it.
export async function inventory(root) {
 return summarize(classifyPaths(await walk(root)));
}
