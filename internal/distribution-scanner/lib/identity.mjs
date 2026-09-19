// Candidate identity across a whole run.
//
// `contact-link.mjs` answers "has this candidate been written to?" by asking
// contact-state. This module answers a different question that only exists once discovery
// produces many candidates at once:
//
//   "are two of these candidates the same party?"
//
// Getting that wrong in either direction costs something. Missing a duplicate spends two
// first contacts on one person. *Inventing* one silently deletes a real candidate, or
// worse, attaches one party's evidence to another. So the answers are deliberately few
// and the uncertain one is not a decision:
//
//   MATCH       two candidates declare the same owner. Same party, and the run may treat
//               them as one.
//   AMBIGUOUS   their names share an uncommon token and nothing else. Never merged; both
//               go to a human, who is the only thing here allowed to conclude anything.
//   UNRESOLVED  no owner is declared, so there is nothing to compare.
//
// There is no fuzzy score and no threshold to tune. A declared owner is an identity; a
// shared token is a hand raised.
export const IDENTITY_STATES = ['MATCH', 'AMBIGUOUS', 'UNRESOLVED'];

// Tokens that say nothing about who somebody is. Kept separate from the list in
// contact-link.mjs: that one filters names against a contact store, this one filters
// candidate names against each other, and collapsing them would couple two unrelated
// judgements.
const STOPWORDS = new Set([
 'example', 'prospect', 'project', 'projects', 'game', 'games', 'gamedev', 'studio',
 'studios', 'app', 'apps', 'repo', 'repository', 'github', 'gitlab', 'http', 'https',
 'www', 'com', 'net', 'org', 'main', 'master', 'test', 'tests', 'demo', 'open', 'source',
 'tool', 'tools', 'localization', 'localisation', 'locale', 'locales', 'translation',
 'translations', 'translate', 'i18n', 'l10n', 'lang', 'language', 'languages',
 'japanese', 'english', 'unity', 'godot', 'renpy', 'rpgmaker'
]);

const tokens = text => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Tokens distinctive enough that two candidates sharing one are worth a second look.
export const distinctiveTokens = names =>
 new Set(names.flatMap(tokens).filter(token => token.length >= 4 && !STOPWORDS.has(token)));

const normalizeOwner = owner => {
 const text = String(owner ?? '').trim().toLowerCase();
 return text === '' ? null : text;
};

// Resolve identity across a list of `{id, owner, aliases}` records.
//
// Returns one entry per candidate id, in input order, each carrying its group (the
// candidates that are definitely the same party, itself included) and the candidates it
// merely looks like. A candidate is never in another candidate's group on token evidence.
export function resolveIdentities(candidates) {
 const records = candidates.map(candidate => ({
  id: candidate.id,
  owner: normalizeOwner(candidate.owner),
  names: [candidate.id, candidate.owner, ...(candidate.aliases ?? [])].filter(Boolean)
 }));

 const groups = new Map();
 for (const record of records) {
  if (!record.owner) continue;
  if (!groups.has(record.owner)) groups.set(record.owner, []);
  groups.get(record.owner).push(record.id);
 }
 for (const list of groups.values()) list.sort();

 return records.map(record => {
  const group = record.owner ? groups.get(record.owner) : [record.id];

  // Near matches are only interesting between *different* parties: two repositories that
  // already declare the same owner are not ambiguous, they are the same owner.
  const wanted = distinctiveTokens(record.names);
  const near = [];
  for (const other of records) {
   if (other.id === record.id) continue;
   if (record.owner && other.owner && record.owner === other.owner) continue;
   const shared = [...new Set([...distinctiveTokens(other.names)].filter(token => wanted.has(token)))].sort();
   if (shared.length) near.push({id: other.id, shared});
  }
  near.sort((a, b) => (a.id < b.id ? -1 : 1));

  if (near.length) {
   return {
    id: record.id,
    owner: record.owner,
    state: 'AMBIGUOUS',
    group,
    ambiguousWith: near,
    reason: 'shares ' + near.map(hit => hit.shared.join('/') + ' with ' + hit.id).join('; ') +
     '; a human decides whether these are the same party - nothing here merges them'
   };
  }
  if (!record.owner) {
   return {
    id: record.id,
    owner: null,
    state: 'UNRESOLVED',
    group,
    ambiguousWith: [],
    reason: 'no owner is declared for this candidate, so it cannot be matched against the others'
   };
  }
  return {
   id: record.id,
   owner: record.owner,
   state: 'MATCH',
   group,
   ambiguousWith: [],
   reason: group.length > 1
    ? 'declared owner ' + record.owner + ' also owns ' + group.filter(id => id !== record.id).join(', ')
    : 'declared owner ' + record.owner + ', unique in this run'
  };
 });
}
