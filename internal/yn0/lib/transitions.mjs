// YN0 conversation transitions.
//
// Every change to a contact's conversation state goes through one of these, so the
// illegal moves are unrepresentable rather than merely discouraged:
//
//   - an automated receipt can never be filed as a human reply
//   - a CLOSED contact can never be walked back into AWAITING_REPLY by us
//   - a validation answer can never, by itself, put us back into a waiting state
//
// Transitions are pure: each returns a new record and leaves the input untouched.

import {assertTransition, validateContact, VALIDATION_DIMENSIONS, VALIDATION_STATUS} from './model.mjs';

const clone = value => structuredClone(value);

function apply(contact, conversationPatch, {note} = {}) {
 const next = clone(contact);
 const to = conversationPatch.conversation_status ?? contact.conversation.conversation_status;
 assertTransition(contact.conversation.conversation_status, to);
 next.conversation = {...next.conversation, ...conversationPatch, conversation_status: to};
 if (note) next.notes = [...next.notes, note];
 const problems = validateContact(next);
 if (problems.length) throw new Error('transition produced an invalid contact:\n - ' + problems.join('\n - '));
 return next;
}

// We sent the first outreach. Sending a question is what puts us in AWAITING_REPLY;
// nothing else does.
export const recordOutreach = (contact, {at = null, note} = {}) =>
 apply(contact, {
  outreach_status: 'SENT',
  conversation_status: 'AWAITING_REPLY',
  waiting_for_reply: true,
  follow_up_allowed: false,
  reopen_condition: 'OPEN',
  last_outbound_at: at
 }, {note});

// We asked something further in a live conversation.
export const recordOutboundQuestion = (contact, {at = null, note} = {}) =>
 apply(contact, {
  outreach_status: 'FOLLOW_UP_SENT',
  conversation_status: 'AWAITING_REPLY',
  waiting_for_reply: true,
  follow_up_allowed: false,
  last_outbound_at: at
 }, {note});

// A ticket receipt, vacation responder or other machine reply. It moves no state:
// `human_reply` stays false and we keep waiting for an actual person.
export const recordAutoAck = (contact, {at = null, note} = {}) =>
 apply(contact, {
  outreach_status: contact.conversation.human_reply ? contact.conversation.outreach_status : 'AUTO_ACK_ONLY',
  last_auto_ack_at: at
 }, {note});

// A human wrote to us. On a finished conversation this is the re-open path, and it
// is the only one: INBOUND_ONLY means they may restart it and we may not.
export function recordHumanInbound(contact, {at = null, note} = {}) {
 const status = contact.conversation.conversation_status;
 const finished = status === 'CLOSED' || status === 'STALLED';
 if (finished && contact.conversation.reopen_condition !== 'INBOUND_ONLY') {
  throw new Error(contact.id + ': ' + status + ' with reopen_condition ' + contact.conversation.reopen_condition + ' cannot be re-opened');
 }
 return apply(contact, {
  outreach_status: 'ANSWERED',
  human_reply: true,
  conversation_status: 'REPLIED',
  waiting_for_reply: false,
  follow_up_allowed: false,
  reopen_condition: 'OPEN',
  last_inbound_at: at
 }, {note});
}

// Record an evidence-backed answer to one validation question.
//
// This touches validation only. A contact does not start waiting because a dimension
// is still UNKNOWN, and does not stop being closed because one turned POSITIVE.
export function recordValidation(contact, dimension, status, evidence) {
 if (!VALIDATION_DIMENSIONS.includes(dimension)) throw new Error('unknown validation dimension: ' + dimension);
 if (!VALIDATION_STATUS.includes(status)) throw new Error('unknown validation status: ' + status);
 if (status !== 'UNKNOWN' && !evidence) throw new Error(dimension + ': ' + status + ' requires evidence');
 const next = clone(contact);
 const cell = next.validation[dimension];
 cell.status = status;
 if (evidence) cell.evidence = [...cell.evidence, clone(evidence)];
 const problems = validateContact(next);
 if (problems.length) throw new Error('recordValidation produced an invalid contact:\n - ' + problems.join('\n - '));
 return next;
}

// The exchange is over. Closing is what makes follow-up impossible; it is not a
// side effect of having no answer yet.
export const closeConversation = (contact, {reopen = 'INBOUND_ONLY', note} = {}) =>
 apply(contact, {
  conversation_status: 'CLOSED',
  waiting_for_reply: false,
  follow_up_allowed: false,
  reopen_condition: reopen
 }, {note});

// The exchange ran out without answers and we chose not to chase it.
export const stallConversation = (contact, {reopen = 'INBOUND_ONLY', note} = {}) =>
 apply(contact, {
  conversation_status: 'STALLED',
  waiting_for_reply: false,
  follow_up_allowed: false,
  reopen_condition: reopen
 }, {note});

// No outreach relationship to manage - typically a public thread we merely watch.
export const observeOnly = (contact, {note} = {}) =>
 apply(contact, {
  conversation_status: 'OBSERVE',
  waiting_for_reply: false,
  follow_up_allowed: false,
  reopen_condition: 'INBOUND_ONLY'
 }, {note});

// Stop expecting an answer without closing the conversation.
//
// This is the transition the whole model exists for: a question stays sent, and we
// stop treating its answer as owed. Muraoka is exactly this shape - the questions
// were asked, then explicitly released ("no need to answer them if you'd rather
// not"), so the contact is not in anyone's reply queue even though payer is UNKNOWN.
export const releaseWaiting = (contact, {note} = {}) =>
 apply(contact, {conversation_status: 'CONTACTED', waiting_for_reply: false}, {note});

// Explicitly permit one outbound follow-up on a live conversation. Deliberately a
// named decision: nothing in the derivation grants this on its own.
export function allowFollowUp(contact, {note} = {}) {
 if (contact.conversation.waiting_for_reply) {
  throw new Error(contact.id + ': cannot allow a follow-up while an answer is still owed to us; release the wait first');
 }
 return apply(contact, {follow_up_allowed: true}, {note});
}
