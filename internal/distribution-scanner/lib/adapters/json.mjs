// JSON file adapter for the YN0 Distribution Scanner.
//
// The only module that knows how a JSON locale file is shaped. It turns one file's
// raw text into normalized entries (see ../entries.mjs); the checker never sees a
// parse tree, a filename or an extension.
import {entry} from '../entries.mjs';

// Flatten nested objects/arrays into dotted keys. Only leaf scalars become entries,
// so structural nesting on either side never counts as a translatable string.
export function flatten(value, prefix = '', out = {}) {
 if (Array.isArray(value)) {
  value.forEach((item, index) => flatten(item, prefix ? prefix + '.' + index : String(index), out));
 } else if (value && typeof value === 'object') {
  for (const key of Object.keys(value)) flatten(value[key], prefix ? prefix + '.' + key : key, out);
 } else if (prefix) {
  out[prefix] = value === null ? '' : String(value);
 }
 return out;
}

export const jsonAdapter = {
 id: 'json',
 label: 'JSON',
 extensions: ['.json'],
 parse(text) {
  let parsed;
  try {
   parsed = JSON.parse(text);
  } catch (error) {
   return {ok: false, reason: 'unreadable JSON: ' + error.message};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
   return {ok: false, reason: 'top-level JSON value is not an object'};
  }
  const flat = flatten(parsed);
  // A dotted key already says where the string lives, so this adapter sets no location.
  return {ok: true, entries: Object.keys(flat).map(key => entry(key, flat[key]))};
 }
};

export default jsonAdapter;
