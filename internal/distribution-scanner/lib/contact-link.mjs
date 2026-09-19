// The boundary between prospect discovery and internal/contact-state.
//
// contact-state stays the single source of truth for "what state is this contact in?".
// This module reads it and stores nothing: no contact record is created, copied,
// summarised into the prospect report, or written back. What crosses the boundary is
// one enum per prospect - a *posture* - plus the contact ids it came from.
//
// The direction matters. Discovery asks contact-state a question; it never tells
// contact-state anything, and it never reimplements the state machine. Every posture
// below is a fold of `derive()`'s own `next_action` and the stored conversation, so a
// change to the contact model shows up here rather than being silently contradicted.
//
// Nothing in this module sends anything, and no posture means "contact them". The most
// positive answer available is NEVER_CONTACTED, which means only that the store was
// consulted and had nothing - a human still decides whether anyone is written to.
//
// Two claims are routed through here and they are not the same claim:
//
//   contact_ids: []          a *human* read the store and found nothing.
//   contact_ids: undefined   nobody declared anything - which, since this file learned to
//                            look the party up itself, no longer means nobody looked. It
//                            means the machine looks, and says which of the five answers
//                            in contact-match.mjs it got. Only NO_MATCH becomes
//                            NEVER_CONTACTED; everything else fails closed to UNCHECKED
//                            or AMBIGUOUS_MATCH.
//
// A declared link is still authoritative over the lookup for *which* contact this is -
// but it is not authoritative against it. When a human declared "never contacted" or
// "contact X" and the store's own identifiers say otherwise, that disagreement is the
// most dangerous thing this module can see, and it is reported as AMBIGUOUS_MATCH rather
// than resolved in either direction.
import {readFile} from 'node:fs/promises';
import {loadStore} from '../../contact-state/lib/store.mjs';
import {derive} from '../../contact-state/lib/derive.mjs';
import {buildIndex, distinctiveTokens, matchProspect, prospectIdentity, weakMatches} from './contact-match.mjs';

// Ordered most restrictive first. When a prospect resolves to several contacts, the
// most restrictive posture wins - two threads, one of them opted out, is opted out.
export const POSTURES = [
 'DO_NOT_CONTACT',   // opted out; reopen_condition NEVER
 'CLOSED',           // the conversation is over
 'INBOUND_ONLY',     // closed, reopens only if they write to us
 'ALREADY_CONTACTED',// a live thread exists, or we owe them a reply
 'AWAITING_REPLY',   // we asked something and the answer is outstanding
 'NEEDS_HUMAN',      // contact-state itself routes this record to REVIEW
 'UNRESOLVED',       // the prospect names a contact id the store does not have
 'AMBIGUOUS_MATCH',  // the prospect claims no contact, but something in the store looks like it
 'UNCHECKED',        // no store was consulted, or the prospect declared no contact link
 'NEVER_CONTACTED'   // store consulted, nothing matched, nothing looked close
];

const RANK = Object.fromEntries(POSTURES.map((posture, index) => [posture, index]));

// How the store answered, independently of what the posture then is. This is the
// distinction the whole exercise turns on: "checked, and this party is new" is a
// different fact from "nobody checked", and a report that cannot tell them apart cannot
// be trusted to say anybody is new.
export const CONCLUSIONS = [
 'MATCHED',       // the store recognized this party
 'NO_MATCH',      // the store was checked and could exclude every contact in it
 'INCONCLUSIVE',  // the store was checked and could not settle the question
 'NOT_CONSULTED'  // no store, or nothing to check it against
];

// One contact's posture, folded from its own derived state. Ordered: the first match
// wins, exactly like contact-state's own next_action table.
export function postureOf(contact) {
 const c = contact.conversation;
 const d = derive(contact);
 if (c.reopen_condition === 'NEVER') return {posture: 'DO_NOT_CONTACT', reason: 'contact opted out'};
 if (d.next_action === 'REVIEW') return {posture: 'NEEDS_HUMAN', reason: 'contact-state routes this record to REVIEW: ' + d.next_action_reason};
 if (c.conversation_status === 'CLOSED') {
  return c.reopen_condition === 'INBOUND_ONLY'
   ? {posture: 'INBOUND_ONLY', reason: 'conversation is CLOSED and reopens only on inbound'}
   : {posture: 'CLOSED', reason: 'conversation is CLOSED'};
 }
 if (d.next_action === 'CLOSE') return {posture: 'CLOSED', reason: 'contact-state says CLOSE: ' + d.next_action_reason};
 if (d.next_action === 'WAIT') return {posture: 'AWAITING_REPLY', reason: d.next_action_reason};
 return {posture: 'ALREADY_CONTACTED', reason: 'a thread already exists (' + d.next_action + ': ' + d.next_action_reason + ')'};
}

// Validation axes with an answer genuinely outstanding somewhere in the store.
//
// This is the Prospect Burn rule that has nothing to do with any one prospect: while
// one contact owes us an answer on the workflow question, opening the same question
// with a second stranger buys no information we are not already about to get.
export function outstandingAxes(store) {
 const axes = new Set();
 for (const {contact} of store.contacts) {
  const d = derive(contact);
  if (d.is_waiting && contact.conversation.waiting_for_axis) axes.add(contact.conversation.waiting_for_axis);
 }
 return [...axes].sort();
}

// Contacts whose identity shares an uncommon token with the prospect's. Deliberately
// crude: this exists to raise a hand, not to decide anything. Any hit forces a human
// to confirm the prospect is not somebody we have already written to under another name.
//
// The token rule lives in contact-match.mjs now, so the crude net and the exact matcher
// cannot drift apart into two different opinions about what a distinctive name is.
export function nearMatches(names, store) {
 if (distinctiveTokens(names).size === 0) return [];
 return weakMatches(buildIndex(store), {names, logins: [], repositories: []})
  .filter(hit => hit.shared.length)
  .map(hit => ({id: hit.id, shared: hit.shared, kinds: ['shared_token']}));
}

// Load a contact store from raw text. The prospect layer never writes one.
export const readContactStore = (text, label) => loadStore(text, label);

// Load a contact store from a file, and fail if it cannot be loaded.
//
// This exists so that "the store could not be read" has exactly one behaviour everywhere:
// it throws. A caller that swallowed the error and carried on with `null` would turn a
// read failure into "no store provided", and a caller that defaulted to an empty store
// would turn it into "checked, nobody is in there" - the silent false negative this whole
// layer exists to prevent. There is no option flag to make either of those happen.
export async function loadContactStoreFile(file) {
 let text;
 try {
  text = await readFile(file, 'utf8');
 } catch (error) {
  throw new Error('contact store ' + file + ' could not be read: ' + error.message);
 }
 return loadStore(text, file);
}

// A result in the shape the rest of the pipeline reads. `conclusion` is deliberately
// separate from `posture`: a reader that only wants "is this safe to propose?" reads the
// posture, and a reader that wants "did anybody actually look?" reads the conclusion.
const result = (posture, reason, extra = {}) => ({
 posture,
 reason,
 contactIds: [],
 nearMatches: [],
 conclusion: 'NOT_CONSULTED',
 matchState: null,
 matchEvidence: [],
 linkSource: 'NONE',
 ...extra
});

// Weak hits, reduced to what a report may carry: which contact, and what kind of
// similarity. The shape is the same one `nearMatches` has always returned, plus the kinds.
const weakToNear = weak => weak.map(hit => ({id: hit.id, shared: hit.shared, kinds: hit.reasons.map(reason => reason.kind)}));

// Fold several contacts' postures into one. Most restrictive wins: two threads, one of
// them opted out, is opted out.
function foldPostures(ids, byId) {
 const resolved = ids.map(id => ({id, ...postureOf(byId.get(id))}));
 return resolved.reduce((a, b) => (RANK[a.posture] <= RANK[b.posture] ? a : b));
}

// Resolve one prospect's contact posture.
//
//   store       a loaded contact store, or null when none was provided
//   contactIds  the prospect's declared links. `[]` is a *positive* claim by a human -
//               "I read the store and it holds nothing for this party". `undefined` means
//               nobody declared anything, and the store is now searched automatically.
//   names       identity strings to look for near-matches against (directory name,
//               declared aliases). Kept for callers that have nothing better.
//   candidate   the candidate's public identity - {id, owner, repository, url, aliases,
//               emails} - which is what makes the automatic lookup possible at all.
export function resolvePosture(store, contactIds, names = [], candidate = null) {
 if (!store) {
  return result('UNCHECKED', 'no contact store was provided; contact history is unknown');
 }

 const identity = prospectIdentity(candidate ?? {});
 // Whatever the caller knows to call this party, on top of whatever the candidate
 // declares. These only ever feed the weak net: a name somebody typed into a report is
 // not an identifier the party owns.
 identity.names = [...new Set([...identity.names, ...names.map(String)])];
 const index = buildIndex(store);
 const match = matchProspect(index, identity);
 const byId = new Map(store.contacts.map(({contact}) => [contact.id, contact]));

 const base = {
  matchState: match.state,
  matchEvidence: match.evidence,
  nearMatches: weakToNear(match.weak)
 };

 // ---- Nobody declared a link: the store answers for itself. ---------------------------
 if (contactIds === undefined || contactIds === null) {
  if (match.state === 'MATCHED') {
   const worst = foldPostures(match.contactIds, byId);
   return result(worst.posture, 'matched by ' + match.reason + ' - ' + worst.id + ': ' + worst.reason, {
    ...base, contactIds: match.contactIds, conclusion: 'MATCHED', linkSource: 'MATCHED', nearMatches: []
   });
  }
  if (match.state === 'AMBIGUOUS') {
   return result('AMBIGUOUS_MATCH', 'no declared contact link and ' + match.reason, {...base, conclusion: 'INCONCLUSIVE'});
  }
  if (match.state === 'NO_MATCH') {
   return result('NEVER_CONTACTED', 'contact store searched by identity; ' + match.reason, {
    ...base, conclusion: 'NO_MATCH'
   });
  }
  // UNIDENTIFIABLE and STORE_NOT_INDEXED are both "the question was not actually
  // answered". They are reported apart because the fix is different - identify the
  // candidate, or index the store - but neither may become "never contacted".
  return result('UNCHECKED', 'contact history is unproven: ' + match.reason, {...base, conclusion: 'NOT_CONSULTED'});
 }

 // ---- A human declared something: honour it, and check it against the store. ----------
 const ids = [...contactIds].sort();
 const missing = ids.filter(id => !byId.has(id));
 if (missing.length) {
  return result('UNRESOLVED', 'declared contact id not in the store: ' + missing.join(', '), {
   ...base, contactIds: ids, conclusion: 'INCONCLUSIVE', linkSource: 'DECLARED', nearMatches: []
  });
 }

 // The disagreement that matters most. The declaration says one thing, the party's own
 // identifiers say another; nothing here is entitled to decide which is right, and
 // guessing in the direction of "never contacted" is the accident we are guarding against.
 const unexplained = match.state === 'MATCHED' ? match.contactIds.filter(id => !ids.includes(id)) : [];
 if (unexplained.length) {
  return result('AMBIGUOUS_MATCH',
   (ids.length === 0
    ? 'declared as never contacted, but '
    : 'declared as ' + ids.join(', ') + ', but ') +
   'the store\'s own identifiers match ' + unexplained.join(', ') + ' (' + match.reason + ')', {
    ...base, contactIds: ids, conclusion: 'INCONCLUSIVE', linkSource: 'DECLARED', nearMatches: []
   });
 }

 if (ids.length === 0) {
  const close = nearMatches(names, store);
  if (close.length) {
   return result('AMBIGUOUS_MATCH',
    'declared as never contacted, but ' + close.map(hit => hit.id + ' (' + hit.shared.join(', ') + ')').join('; ') +
    ' looks like the same party', {...base, conclusion: 'INCONCLUSIVE', linkSource: 'DECLARED', nearMatches: close});
  }
  return result('NEVER_CONTACTED', 'contact store consulted; no record and no near match', {
   ...base, conclusion: 'NO_MATCH', linkSource: 'DECLARED', nearMatches: []
  });
 }

 const worst = foldPostures(ids, byId);
 return result(worst.posture, worst.id + ': ' + worst.reason, {
  ...base, contactIds: ids, conclusion: 'MATCHED', linkSource: 'DECLARED', nearMatches: []
 });
}
