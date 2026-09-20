// Recognizing a discovered party in the contact store.
//
// This is the module the whole Prospect Burn guard rests on. Discovery finds a
// repository; contact-state knows who we have written to; between them sits exactly one
// question:
//
//   "Is this party somebody we have already contacted?"
//
// There are three honest answers and this module gives all three, plus the two ways of
// having no answer at all. They are not symmetrical, and the asymmetry is the design:
//
//   MATCHED            an identifier this party owns is an identifier a contact claims.
//   AMBIGUOUS          something looks similar. Never a match, never a non-match - a
//                      human decides, and until then the candidate does not move.
//   NO_MATCH           every contact in the store was exclusible, and none was this
//                      party. This is the *only* answer that lets a candidate be
//                      proposed, and it is the one with the strictest preconditions.
//   UNIDENTIFIABLE     the party carries no identifier the store could be checked
//                      against. Not a non-match: a question that was never asked.
//   STORE_NOT_INDEXED  the store holds a contact with no identity evidence at all. That
//                      contact cannot be excluded, so nobody can be declared a stranger.
//
// The failure mode this shape exists to prevent is one-directional. Wrongly matching two
// people costs a human five minutes of reading. Wrongly declaring a person we already
// burned to be a stranger costs the relationship, and we would never find out. So every
// rule below fails towards MATCHED / AMBIGUOUS and away from NO_MATCH, and no rule may
// conclude sameness from similarity.
//
// What is never evidence of identity, no matter how suggestive:
//   - a shared or similar personal name
//   - a shared organization, employer or community
//   - a common username fragment (one login spelled inside a longer one)
//   - a bare repository name without its owner
//   - the same kind of project, topic, engine or language
// Each of those raises AMBIGUOUS at most. Only exact equality on an identifier a party
// actually owns - a GitHub login, an owner/name repository, a full alias, an address, a
// domain, or a link a human wrote down by hand - is a match.
//
// Nothing here reads a clock, makes a network call or writes anything.
import {IDENTITY_KINDS, identityKeys, normalizeAlias, normalizeRepository} from '../../contact-state/lib/model.mjs';
import {identityCoverage} from '../../contact-state/lib/store.mjs';

export const MATCH_STATES = ['MATCHED', 'AMBIGUOUS', 'NO_MATCH', 'UNIDENTIFIABLE', 'STORE_NOT_INDEXED'];

// Kinds of exact evidence, strongest first. Reported so a human reading "MATCHED" can see
// what the machine matched on without the report having to carry the value itself.
export const MATCH_KINDS = ['manual_link', 'repository', 'github_login', 'email', 'domain', 'alias'];

// Kinds of evidence that only ever raise a hand.
export const WEAK_KINDS = ['shared_token', 'login_fragment', 'repository_name'];

// Tokens that say nothing about who somebody is. A name made only of these has no
// distinctive token, and an alias with no distinctive token is not an identity: "Game
// Project" must never match "Game Project".
const STOPWORDS = new Set([
 'example', 'prospect', 'project', 'projects', 'game', 'games', 'gamedev', 'studio',
 'studios', 'app', 'apps', 'repo', 'repository', 'github', 'gitlab', 'http', 'https',
 'www', 'com', 'net', 'org', 'main', 'master', 'test', 'tests', 'demo', 'open', 'source',
 'tool', 'tools', 'localization', 'localisation', 'locale', 'locales', 'translation',
 'translations', 'translate', 'i18n', 'l10n', 'lang', 'language', 'languages',
 'japanese', 'english', 'unity', 'godot', 'renpy', 'rpgmaker', 'team', 'group'
]);

const MIN_TOKEN = 4;

export const tokens = text => normalizeAlias(text).split(' ').filter(Boolean);

// Tokens distinctive enough to be worth a human's second look. Never enough to conclude
// anything by themselves.
export const distinctiveTokens = names =>
 new Set(names.flatMap(tokens).filter(token => token.length >= MIN_TOKEN && !STOPWORDS.has(token)));

const hasDistinctiveToken = text => distinctiveTokens([text]).size > 0;

const key = (kind, value) => kind + ':' + value;

// ---------------------------------------------------------------------------------------
// The store side: every identifier every contact claims.
// ---------------------------------------------------------------------------------------

// One store, turned into the two things a lookup needs: an exact key -> contact ids map,
// and the weak-evidence material (names and near-identifiers) that raises a hand.
//
// A key claimed by two contacts is not a conflict. One party reached on two channels is
// two records by design (see internal/contact-state), and resolving to both of them is
// correct: the most restrictive posture of the two wins downstream.
export function buildIndex(store) {
 const exact = new Map();
 const entries = [];
 for (const {contact} of store.contacts) {
  const keys = identityKeys(contact);
  for (const k of keys) {
   if (!exact.has(k)) exact.set(k, new Set());
   exact.get(k).add(contact.id);
  }
  entries.push({
   id: contact.id,
   keys,
   // Weak material. Contact names and organizations are here because a contact recorded
   // before identity evidence existed can still raise a hand by its name alone.
   tokens: distinctiveTokens([
    contact.id, contact.name, contact.organization, contact.channel_ref,
    ...(contact.identity?.aliases ?? []),
    ...(contact.identity?.github_logins ?? []),
    ...(contact.identity?.repositories ?? [])
   ]),
   logins: new Set(contact.identity?.github_logins ?? []),
   repositoryNames: new Set((contact.identity?.repositories ?? []).map(repo => repo.split('/')[1]))
  });
 }
 return {exact, entries: entries.sort((a, b) => (a.id < b.id ? -1 : 1)), coverage: identityCoverage(store)};
}

// ---------------------------------------------------------------------------------------
// The prospect side: every identifier a discovered candidate carries.
// ---------------------------------------------------------------------------------------

// Pull `owner/name` out of a repository URL. Only a github.com URL names a login in its
// path; for any other host the path is just a path, and the host itself is the identity.
function fromUrl(raw) {
 const out = {repositories: [], logins: [], domains: []};
 let url;
 try {
  url = new URL(String(raw));
 } catch {
  return out;
 }
 if (url.protocol !== 'http:' && url.protocol !== 'https:') return out;
 const host = url.hostname.toLowerCase().replace(/^www\./, '');
 const segments = url.pathname.split('/').filter(Boolean).map(segment => segment.toLowerCase());
 if (host === 'github.com' || host === 'gist.github.com') {
  if (segments.length >= 1) out.logins.push(segments[0]);
  if (segments.length >= 2) out.repositories.push(normalizeRepository(segments[0] + '/' + segments[1]));
 } else {
  out.domains.push(host);
 }
 return out;
}

// Everything a candidate offers that could identify its party, normalized into the same
// vocabulary the store index uses.
//
//   id          the candidate id, as a manifest spells it. Used for manual links and for
//               weak token evidence - never as an identity of its own, because it is a
//               name discovery invented, not one the party chose.
//   owner       the repository owner / GitHub login.
//   repository  `owner/name`, or a bare name to be completed from `owner`.
//   url         the public URL the candidate was found at.
//   aliases     names declared for this candidate by a human.
//   emails      addresses, which only ever come from a local store - discovery collects
//               none, and no tracked file carries one.
export function prospectIdentity(raw = {}) {
 const id = raw.id === undefined || raw.id === null ? null : String(raw.id).trim().toLowerCase();
 const owner = raw.owner ? String(raw.owner).trim().toLowerCase().replace(/^@/, '') : null;

 const logins = new Set();
 const repositories = new Set();
 const domains = new Set();
 const aliases = new Set();
 const emails = new Set();

 if (owner) logins.add(owner);
 if (raw.repository) {
  const repo = normalizeRepository(raw.repository);
  if (repo.includes('/')) {
   repositories.add(repo);
   logins.add(repo.split('/')[0]);
  } else if (owner) {
   repositories.add(normalizeRepository(owner + '/' + repo));
  }
 }
 const fromLink = fromUrl(raw.url);
 for (const value of fromLink.logins) logins.add(value);
 for (const value of fromLink.repositories) repositories.add(value);
 for (const value of fromLink.domains) domains.add(value);
 for (const value of raw.aliases ?? []) {
  const alias = normalizeAlias(value);
  if (alias) aliases.add(alias);
 }
 for (const value of raw.emails ?? []) {
  const email = String(value).trim().toLowerCase();
  if (email.includes('@')) emails.add(email);
 }

 // An alias with no distinctive token is a category, not a name. It may raise a hand; it
 // may not settle anything.
 const exactAliases = [...aliases].filter(hasDistinctiveToken).sort();

 return {
  id,
  owner,
  logins: [...logins].filter(Boolean).sort(),
  repositories: [...repositories].filter(value => value.includes('/')).sort(),
  domains: [...domains].sort(),
  aliases: [...aliases].sort(),
  exactAliases,
  emails: [...emails].sort(),
  // The names weak token evidence is computed from. The candidate id belongs here and
  // nowhere else.
  names: [id, raw.owner, raw.repository, raw.url, ...(raw.aliases ?? [])].filter(Boolean).map(String)
 };
}

// Can the store be asked about this party at all? Only an identifier the party owns
// counts. A candidate id does not: it is a manifest's name for a directory, so "no
// contact manually linked to it" is not "this party is not in the store".
export function isIdentifiable(identity) {
 return identity.logins.length > 0 ||
  identity.repositories.length > 0 ||
  identity.emails.length > 0 ||
  identity.domains.length > 0 ||
  identity.exactAliases.length > 0;
}

// The exact keys this candidate would match on, strongest kind first.
export function prospectKeys(identity) {
 const keys = [];
 if (identity.id) keys.push(key(IDENTITY_KINDS.manual_links, identity.id));
 for (const value of identity.repositories) keys.push(key(IDENTITY_KINDS.repositories, value));
 for (const value of identity.logins) keys.push(key(IDENTITY_KINDS.github_logins, value));
 for (const value of identity.emails) keys.push(key(IDENTITY_KINDS.emails, value));
 for (const value of identity.domains) keys.push(key(IDENTITY_KINDS.domains, value));
 for (const value of identity.exactAliases) keys.push(key(IDENTITY_KINDS.aliases, value));
 return keys;
}

// ---------------------------------------------------------------------------------------
// The lookup.
// ---------------------------------------------------------------------------------------

// Similarity, and only similarity. Every hit here is a hand raised for a human; none of
// them is allowed to become a match or to be subtracted from one.
export function weakMatches(index, identity) {
 const wanted = distinctiveTokens(identity.names);
 const hits = [];
 for (const entry of index.entries) {
  const reasons = [];
  const shared = [...entry.tokens].filter(token => wanted.has(token)).sort();
  if (shared.length) reasons.push({kind: 'shared_token', detail: shared.join(', ')});
  for (const login of entry.logins) {
   for (const mine of identity.logins) {
    if (login === mine) continue;
    if (login.length >= MIN_TOKEN && mine.length >= MIN_TOKEN && (login.includes(mine) || mine.includes(login))) {
     reasons.push({kind: 'login_fragment', detail: 'one login contains the other'});
    }
   }
  }
  for (const repo of identity.repositories) {
   const name = repo.split('/')[1];
   if (entry.repositoryNames.has(name) && !entry.keys.includes(key(IDENTITY_KINDS.repositories, repo))) {
    reasons.push({kind: 'repository_name', detail: 'same repository name under a different owner'});
   }
  }
  if (reasons.length) {
   const seen = new Set();
   hits.push({
    id: entry.id,
    shared,
    reasons: reasons.filter(reason => !seen.has(reason.kind) && seen.add(reason.kind))
   });
  }
 }
 return hits;
}

// Resolve one candidate against one store index.
//
// Ordered, and the order is the safety argument:
//   1. an exact identifier wins - it is the only thing that may conclude sameness;
//   2. otherwise, a party we cannot identify was never actually checked;
//   3. otherwise, anything that looks similar goes to a human;
//   4. otherwise, an opaque contact in the store means nobody can be excluded;
//   5. only then is "not in the store" a thing the machine is entitled to say.
export function matchProspect(index, identity) {
 const evidence = [];
 const contactIds = new Set();
 for (const k of prospectKeys(identity)) {
  const hit = index.exact.get(k);
  if (!hit) continue;
  const [kind] = k.split(':');
  for (const id of [...hit].sort()) {
   contactIds.add(id);
   evidence.push({contactId: id, kind});
  }
 }
 if (contactIds.size) {
  const kinds = [...new Set(evidence.map(item => item.kind))].sort();
  return {
   state: 'MATCHED',
   contactIds: [...contactIds].sort(),
   evidence,
   weak: [],
   reason: 'exact identity match on ' + kinds.join(', ') + ' with ' + [...contactIds].sort().join(', ')
  };
 }

 const weak = weakMatches(index, identity);
 if (!isIdentifiable(identity)) {
  return {
   state: 'UNIDENTIFIABLE',
   contactIds: [],
   evidence: [],
   weak,
   reason: 'the candidate carries no identifier (owner, owner/name repository, address, ' +
    'domain or distinctive alias) the contact store could be checked against'
  };
 }
 if (weak.length) {
  return {
   state: 'AMBIGUOUS',
   contactIds: [],
   evidence: [],
   weak,
   reason: 'no exact identity match, but ' +
    weak.map(hit => hit.id + ' (' + hit.reasons.map(reason => reason.kind).join(', ') + ')').join('; ') +
    ' may be the same party; similarity is never a match and never a non-match'
  };
 }
 if (!index.coverage.complete) {
  return {
   state: 'STORE_NOT_INDEXED',
   contactIds: [],
   evidence: [],
   weak: [],
   reason: index.coverage.contactCount === 0
    ? 'the contact store holds no contacts at all, which is indistinguishable from the wrong file'
    : index.coverage.opaqueCount + ' contact(s) carry no identity evidence (' +
      index.coverage.opaqueIds.join(', ') + '), so they cannot be excluded and nobody can be shown to be a stranger'
  };
 }
 return {
  state: 'NO_MATCH',
  contactIds: [],
  evidence: [],
  weak: [],
  reason: 'every one of the ' + index.coverage.contactCount + ' contact(s) in the store carries identity evidence, ' +
   'and none of it matches this candidate'
 };
}
