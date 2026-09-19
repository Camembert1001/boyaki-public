// Derived state for the YN0 contact state machine.
//
// Everything here is a pure function of the stored record - no clock, no model
// call, no free text. `next_action` in particular is decided by an ordered rule
// list, so "why does this say FOLLOW_UP" always has a rule number as its answer.
import {VALIDATION_AXES, isBefore} from './model.mjs';

export const NEXT_ACTIONS = ['REVIEW', 'RESPOND', 'DO_NOT_CONTACT', 'WAIT', 'CLOSE', 'FOLLOW_UP'];

// Statuses in which a reply can still meaningfully be outstanding. STALLED and
// CLOSED are absent on purpose: that is the bug this model exists to stop.
const WAITABLE = ['AWAITING_REPLY', 'VALIDATING'];
const LIVE = ['CONTACTED', 'AWAITING_REPLY', 'REPLIED', 'VALIDATING', 'STALLED'];

// Stored-state contradictions. These are reported, not repaired: a record that
// claims two incompatible things is a human's problem, and it routes to REVIEW
// rather than to any action that sends something.
export function checkConsistency(contact) {
 const c = contact.conversation;
 const problems = [];
 const add = message => problems.push(message);

 if (c.waiting_for_reply) {
  if (!WAITABLE.includes(c.conversation_status)) add('waiting_for_reply=true while conversation_status=' + c.conversation_status);
  if (c.waiting_for === 'NOTHING') add('waiting_for_reply=true but waiting_for=NOTHING');
  if (c.reply_waived) add('waiting_for_reply=true but we waived the reply');
  if (c.outreach_status !== 'SENT') add('waiting_for_reply=true but outreach_status=' + c.outreach_status);
 } else if (c.waiting_for !== 'NOTHING') {
  add('waiting_for=' + c.waiting_for + ' while waiting_for_reply=false');
 }

 // An axis names *which* answer is outstanding, so it only makes sense while one is.
 if (c.waiting_for_axis !== null && !['VALIDATION_ANSWER', 'PAYER_ANSWER'].includes(c.waiting_for)) {
  add('waiting_for_axis=' + c.waiting_for_axis + ' while waiting_for=' + c.waiting_for);
 }
 if (c.waiting_for === 'PAYER_ANSWER' && c.waiting_for_axis !== 'payer') {
  add('waiting_for=PAYER_ANSWER but waiting_for_axis=' + c.waiting_for_axis);
 }
 if (c.waiting_for === 'VALIDATION_ANSWER' && c.waiting_for_axis === 'payer') {
  add('waiting_for=VALIDATION_ANSWER on the payer axis; record it as PAYER_ANSWER');
 }

 if (c.conversation_status === 'CLOSED') {
  if (c.follow_up_allowed) add('follow_up_allowed=true on a CLOSED contact');
  if (c.reopen_condition === 'NOT_APPLICABLE') add('CLOSED contact has no reopen_condition');
 }
 if (c.conversation_status === 'STALLED' && c.reopen_condition === 'NOT_APPLICABLE') {
  add('STALLED contact has no reopen_condition');
 }
 if (c.reopen_condition === 'NEVER' && c.follow_up_allowed) add('follow_up_allowed=true on an opted-out contact');
 if (c.conversation_status === 'DISCOVERED' && c.outreach_status === 'SENT') add('conversation_status=DISCOVERED but outreach_status=SENT');
 if (c.conversation_status !== 'DISCOVERED' && c.outreach_status === 'NOT_SENT' && !c.human_reply) {
  add('conversation_status=' + c.conversation_status + ' but nothing was ever sent or received');
 }
 if (c.outreach_status === 'SENT' && c.last_outbound_at === null) add('outreach_status=SENT but last_outbound_at is null');
 if (c.human_reply && c.last_inbound_at === null) add('human_reply=true but last_inbound_at is null');
 if (!c.human_reply && c.last_inbound_at !== null) add('last_inbound_at is set but human_reply=false');

 for (const axis of VALIDATION_AXES) {
  const value = contact.validation[axis];
  if (value.status !== 'UNKNOWN' && value.evidence.length === 0) add(axis + '=' + value.status + ' without evidence');
  if (value.status !== 'UNKNOWN' && !c.human_reply) add(axis + '=' + value.status + ' but no human ever replied');
 }
 return problems;
}

export function derive(contact) {
 const c = contact.conversation;
 const v = contact.validation;
 const inconsistencies = checkConsistency(contact);

 // They wrote last and we have not answered. Only meaningful while the thread is live -
 // the final "thanks!" of a closed conversation is not a message we owe a reply to.
 const owes_response = LIVE.includes(c.conversation_status) && isBefore(c.last_outbound_at, c.last_inbound_at);

 const is_waiting = Boolean(c.waiting_for_reply) &&
  !c.reply_waived &&
  WAITABLE.includes(c.conversation_status) &&
  c.waiting_for !== 'NOTHING' &&
  !owes_response;

 const negative = v.problem.status === 'NEGATIVE' || v.usefulness.status === 'NEGATIVE';

 const can_follow_up = Boolean(c.follow_up_allowed) &&
  !c.reply_waived &&
  LIVE.includes(c.conversation_status) &&
  c.outreach_status === 'SENT' &&
  c.reopen_condition !== 'NEVER' &&
  !negative &&
  inconsistencies.length === 0;

 const is_validated = v.problem.status === 'POSITIVE' && v.usefulness.status === 'POSITIVE';
 const is_payer_validated = v.payer.status === 'POSITIVE';

 const [next_action, next_action_reason] = decideNextAction(contact, {
  inconsistencies,
  owes_response,
  is_waiting,
  can_follow_up,
  negative
 });

 const needs_attention = inconsistencies.length > 0 ||
  owes_response ||
  Boolean(c.inbound_since_close) ||
  next_action === 'REVIEW';

 return {
  is_waiting,
  can_follow_up,
  is_validated,
  is_payer_validated,
  owes_response,
  needs_attention,
  next_action,
  next_action_reason,
  inconsistencies
 };
}

// Ordered. The first matching rule wins, and its text becomes next_action_reason.
function decideNextAction(contact, facts) {
 const c = contact.conversation;
 const v = contact.validation;
 if (facts.inconsistencies.length > 0) {
  return ['REVIEW', 'stored state contradicts itself: ' + facts.inconsistencies[0]];
 }
 if (c.inbound_since_close) {
  return ['REVIEW', 'an opted-out contact wrote to us; a human decides whether anything happens'];
 }
 if (c.reopen_condition === 'NEVER') {
  return ['DO_NOT_CONTACT', 'contact opted out'];
 }
 if (facts.owes_response) {
  return ['RESPOND', 'they replied at ' + c.last_inbound_at + ' and we have not answered'];
 }
 if (c.conversation_status === 'CLOSED') {
  return ['DO_NOT_CONTACT', 'conversation is CLOSED' + (c.closed_reason ? ' (' + c.closed_reason + ')' : '') + '; reopen only on inbound'];
 }
 if (facts.is_waiting) {
  // The axis is part of the answer to "waiting for what?" - an outstanding workflow
  // question is not an outstanding price question.
  const what = c.waiting_for + (c.waiting_for_axis === null ? '' : ' on ' + c.waiting_for_axis);
  return ['WAIT', 'waiting for ' + what + ' since ' + c.last_outbound_at];
 }
 if (facts.negative) {
  const axis = v.usefulness.status === 'NEGATIVE' ? 'usefulness' : 'problem';
  return ['CLOSE', axis + ' is NEGATIVE with evidence; nothing left to validate'];
 }
 if (c.reply_waived) {
  return ['CLOSE', 'we told them no reply is needed, so no answer is outstanding'];
 }
 if (c.conversation_status === 'STALLED' && !facts.can_follow_up) {
  return ['CLOSE', 'thread stalled and follow_up_allowed=false'];
 }
 if (c.conversation_status === 'DISCOVERED') {
  return ['REVIEW', 'discovered but never contacted; first contact is a human decision'];
 }
 if (facts.can_follow_up) {
  return ['FOLLOW_UP', 'no answer outstanding, follow-up is permitted' + (c.conversation_status === 'STALLED' ? ' (thread stalled)' : '')];
 }
 return ['REVIEW', 'no rule matched conversation_status=' + c.conversation_status];
}

export function describe(contact) {
 return {...contact, derived: derive(contact)};
}
