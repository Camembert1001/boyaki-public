// External metadata for the YN0 Prospect Discovery layer.
//
// Some things worth knowing about a candidate repository are not in its files: whether
// anyone still maintains it, and whether there is a public route to its maintainers at
// all. Both matter for Prospect Burn - a dead repository and an unreachable one are
// both candidates to drop before a human looks.
//
// Neither is fetched. The scanner core is filesystem-only, holds no credentials and
// makes no network call, and wiring a GitHub client into it to answer "is this repo
// alive?" would trade that property away for a field a human can type. So the shape is
// the opposite: an input file anyone (or any separate tool) can fill, validated here,
// and absent by default. An absent field is never guessed - it reads UNKNOWN, and
// UNKNOWN is a reason to route a prospect to a human rather than to assume the best.
export const SCHEMA = 'yn0-prospect-metadata-v1';

// How alive the repository is. The distinction that matters is DORMANT: nobody is
// going to answer, so the contact is spent for nothing.
export const ACTIVITY_LEVELS = ['ACTIVE', 'MAINTAINED', 'DORMANT', 'UNKNOWN'];

// How a stranger could reach the maintainers in public. NONE means there is no public
// route - which is a reason to drop the candidate, never a reason to go looking for a
// private one.
export const CONTACT_ROUTES = ['GITHUB_ISSUE', 'GITHUB_DISCUSSION', 'PUBLIC_EMAIL', 'OTHER', 'NONE', 'UNKNOWN'];

// `owner`, `repository` and `url` are the candidate's *public* identity, and they are
// here rather than only in a v3 manifest because they are what makes an automatic contact
// check possible: without one of them the contact store cannot be asked about this party
// at all, and "never contacted" stays unprovable. `emails` is the one field that may hold
// something personal, so it only ever appears in a local, untracked metadata file - a
// test asserts no tracked fixture carries an address.
const FIELDS = new Set([
 'aliases', 'activity', 'activity_evidence', 'public_contact_route', 'contact_route_evidence',
 'contact_ids', 'notes', 'owner', 'repository', 'url', 'emails'
]);

export class ProspectMetadataError extends Error {}

const fail = message => {
 throw new ProspectMetadataError(message);
};

const assertEnum = (value, allowed, label) => {
 if (!allowed.includes(value)) fail(label + ' must be one of ' + allowed.join(', ') + ' (got ' + JSON.stringify(value) + ')');
 return value;
};

const assertStrings = (value, label) => {
 if (!Array.isArray(value)) fail(label + ' must be an array of strings');
 for (const item of value) if (typeof item !== 'string' || item.trim() === '') fail(label + ' must hold non-empty strings');
 return [...value];
};

const assertText = (value, label) => {
 if (typeof value !== 'string' || value.trim() === '') fail(label + ' must be a non-empty string');
 return value;
};

export function normalizeEntry(raw, label) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must be an object');
 for (const key of Object.keys(raw)) {
  if (!FIELDS.has(key)) fail(label + ' has unknown field ' + JSON.stringify(key) + '; known fields are ' + [...FIELDS].sort().join(', '));
 }
 if (raw.notes !== undefined && typeof raw.notes !== 'string') fail(label + '.notes must be a string');
 return {
  aliases: raw.aliases === undefined ? [] : assertStrings(raw.aliases, label + '.aliases'),
  activity: assertEnum(raw.activity ?? 'UNKNOWN', ACTIVITY_LEVELS, label + '.activity'),
  activity_evidence: raw.activity_evidence === undefined ? null : String(raw.activity_evidence),
  public_contact_route: assertEnum(raw.public_contact_route ?? 'UNKNOWN', CONTACT_ROUTES, label + '.public_contact_route'),
  contact_route_evidence: raw.contact_route_evidence === undefined ? null : String(raw.contact_route_evidence),
  // undefined is "nobody declared a link"; [] is "a human read the store and there is
  // nothing there". They are not the same claim, so the distinction survives
  // normalization - and `undefined` now means the store is searched by identity rather
  // than that nothing happens.
  contact_ids: raw.contact_ids === undefined ? undefined : assertStrings(raw.contact_ids, label + '.contact_ids'),
  owner: raw.owner === undefined || raw.owner === null ? null : assertText(raw.owner, label + '.owner'),
  repository: raw.repository === undefined || raw.repository === null ? null : assertText(raw.repository, label + '.repository'),
  url: raw.url === undefined || raw.url === null ? null : assertText(raw.url, label + '.url'),
  emails: raw.emails === undefined ? [] : assertStrings(raw.emails, label + '.emails'),
  notes: raw.notes ?? null
 };
}

// Metadata for a prospect nobody has filled in: every field at its least presumptuous value.
export const emptyEntry = () => ({
 aliases: [],
 activity: 'UNKNOWN',
 activity_evidence: null,
 public_contact_route: 'UNKNOWN',
 contact_route_evidence: null,
 contact_ids: undefined,
 owner: null,
 repository: null,
 url: null,
 emails: [],
 notes: null
});

export function loadMetadata(text, label = 'metadata') {
 let parsed;
 try {
  parsed = JSON.parse(text);
 } catch (error) {
  fail(label + ' is not valid JSON: ' + error.message);
 }
 if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(label + ' must be a JSON object');
 if (parsed.schema !== undefined && parsed.schema !== SCHEMA) {
  fail(label + ' has schema ' + JSON.stringify(parsed.schema) + ', expected ' + SCHEMA);
 }
 const raw = parsed.prospects;
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must carry a "prospects" object');
 const prospects = new Map();
 for (const id of Object.keys(raw).sort()) prospects.set(id, normalizeEntry(raw[id], label + ' prospects.' + id));
 return {schema: SCHEMA, prospects};
}
