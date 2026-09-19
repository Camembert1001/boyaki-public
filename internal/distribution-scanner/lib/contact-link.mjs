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
import {loadStore} from '../../contact-state/lib/store.mjs';
import {derive} from '../../contact-state/lib/derive.mjs';

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

// Tokens too common to be evidence that two names are the same party.
const STOPWORDS = new Set([
 'example', 'prospect', 'project', 'projects', 'game', 'games', 'studio', 'studios',
 'app', 'apps', 'repo', 'repository', 'github', 'gitlab', 'http', 'https', 'www',
 'com', 'net', 'org', 'main', 'master', 'test', 'demo', 'open', 'source', 'tool', 'tools'
]);

const tokens = text => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

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
export function nearMatches(names, store) {
 const wanted = new Set(names.flatMap(tokens).filter(token => token.length >= 4 && !STOPWORDS.has(token)));
 if (wanted.size === 0) return [];
 const hits = [];
 for (const {contact} of store.contacts) {
  const theirs = [contact.id, contact.name, contact.organization, contact.channel_ref].flatMap(tokens);
  const shared = [...new Set(theirs.filter(token => wanted.has(token)))].sort();
  if (shared.length) hits.push({id: contact.id, shared});
 }
 return hits.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// Load a contact store from raw text. The prospect layer never writes one.
export const readContactStore = (text, label) => loadStore(text, label);

// Resolve one prospect's contact posture.
//
//   store       a loaded contact store, or null when none was provided
//   contactIds  the prospect's declared links. `[]` is a *positive* claim - "the store
//               was checked and holds nothing for this party" - and is the only way to
//               reach NEVER_CONTACTED. `undefined` means nobody checked.
//   names       identity strings to look for near-matches against (directory name,
//               declared aliases).
export function resolvePosture(store, contactIds, names = []) {
 if (!store) return {posture: 'UNCHECKED', reason: 'no contact store was provided; contact history is unknown', contactIds: [], nearMatches: []};
 if (contactIds === undefined || contactIds === null) {
  return {posture: 'UNCHECKED', reason: 'prospect declares no contact link, so "never contacted" is unproven', contactIds: [], nearMatches: []};
 }

 const byId = new Map(store.contacts.map(({contact}) => [contact.id, contact]));
 const ids = [...contactIds].sort();
 const missing = ids.filter(id => !byId.has(id));
 if (missing.length) {
  return {
   posture: 'UNRESOLVED',
   reason: 'declared contact id not in the store: ' + missing.join(', '),
   contactIds: ids,
   nearMatches: []
  };
 }

 if (ids.length === 0) {
  const close = nearMatches(names, store);
  if (close.length) {
   return {
    posture: 'AMBIGUOUS_MATCH',
    reason: 'declared as never contacted, but ' + close.map(hit => hit.id + ' (' + hit.shared.join(', ') + ')').join('; ') + ' looks like the same party',
    contactIds: [],
    nearMatches: close
   };
  }
  return {posture: 'NEVER_CONTACTED', reason: 'contact store consulted; no record and no near match', contactIds: [], nearMatches: []};
 }

 const resolved = ids.map(id => ({id, ...postureOf(byId.get(id))}));
 const worst = resolved.reduce((a, b) => (RANK[a.posture] <= RANK[b.posture] ? a : b));
 return {
  posture: worst.posture,
  reason: worst.id + ': ' + worst.reason,
  contactIds: ids,
  nearMatches: []
 };
}
