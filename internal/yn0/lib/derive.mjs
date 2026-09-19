// Derived YN0 contact state. Everything here is a pure function of the stored
// record: same record in, same derivation out, no clock, no network, no model call.
//
// next_action is chosen by the ordered rule list below and may only be one of
// NEXT_ACTION. Prose from a chat log never decides it; at most it becomes evidence
// that changes a stored field, and the stored field changes the derivation.

import {NEXT_ACTION, NO_INITIATE_STATUS, FINISHED_STATUS} from './model.mjs';

const POSITIVE = 'POSITIVE';

// Is an answer owed by us rather than to us?
//
// When both timestamps are recorded the comparison is the truth. When they are not
// (the current records predate any message-id capture) we fall back to the state
// that means the same thing: a human wrote back and we are not waiting on anyone.
export function ballInOurCourt(contact) {
 const c = contact.conversation;
 if (c.last_inbound_at && c.last_outbound_at) return c.last_inbound_at > c.last_outbound_at;
 if (c.last_inbound_at && !c.last_outbound_at) return true;
 return c.conversation_status === 'REPLIED' && c.waiting_for_reply === false;
}

// A finished conversation whose door is still open to the other side.
export const canReopen = contact =>
 FINISHED_STATUS.includes(contact.conversation.conversation_status) &&
 contact.conversation.reopen_condition === 'INBOUND_ONLY';

// Ordered rules. The first match wins; the reason string names the rule that fired
// so a human or another session can audit the choice instead of trusting it.
const RULES = [
 [
  'observe',
  c => c.conversation.conversation_status === 'OBSERVE',
  'OBSERVE',
  'Conversation is OBSERVE: there is no outreach relationship to manage, only an outcome to watch.'
 ],
 [
  'finished-no-follow-up',
  c => FINISHED_STATUS.includes(c.conversation.conversation_status) && c.conversation.follow_up_allowed === false,
  'DO_NOT_CONTACT',
  'Conversation is finished and follow-up is not allowed; only a new inbound may re-open it.'
 ],
 [
  'ball-in-our-court',
  c => ballInOurCourt(c),
  'RESPOND',
  'The last message is theirs: a reply is owed by us, not to us.'
 ],
 [
  'waiting',
  c => c.conversation.waiting_for_reply === true,
  'WAIT',
  'An answer is genuinely owed to us; nothing to send.'
 ],
 [
  'not-contacted',
  c => c.conversation.conversation_status === 'DISCOVERED',
  'REVIEW',
  'Discovered but not contacted: a human decides whether to reach out.'
 ],
 [
  'follow-up-allowed',
  c => c.conversation.follow_up_allowed === true && !NO_INITIATE_STATUS.includes(c.conversation.conversation_status),
  'FOLLOW_UP',
  'Live conversation, nothing owed to us, follow-up explicitly allowed.'
 ],
 [
  'spent',
  c => !NO_INITIATE_STATUS.includes(c.conversation.conversation_status),
  'CLOSE',
  'Live conversation with nothing owed either way and no follow-up allowed: close the record.'
 ]
];

// Returns {next_action, rule, reason}.
export function deriveNextAction(contact) {
 for (const [rule, matches, action, reason] of RULES) {
  if (matches(contact)) return {next_action: action, rule, reason};
 }
 return {next_action: 'REVIEW', rule: 'fallback', reason: 'No rule matched; a human should look at this record.'};
}

// Full derived view of one contact. Stored fields are left untouched.
export function derive(contact) {
 const c = contact.conversation;
 const v = contact.validation;
 const {next_action, rule, reason} = deriveNextAction(contact);
 if (!NEXT_ACTION.includes(next_action)) throw new Error('derived a next_action outside the enum: ' + next_action);

 const is_waiting = c.waiting_for_reply === true;
 const can_follow_up = c.follow_up_allowed === true && !NO_INITIATE_STATUS.includes(c.conversation_status);
 // Problem and usefulness are the two questions that say the tool is worth having.
 // Payer is deliberately not part of it, so "validated" can never read as "sold".
 const is_validated = v.problem.status === POSITIVE && v.usefulness.status === POSITIVE;
 const is_payer_validated = v.payer.status === POSITIVE && contact.counts_toward_payer_validation === true;

 return {
  id: contact.id,
  needs_attention: ['RESPOND', 'FOLLOW_UP', 'REVIEW', 'CLOSE'].includes(next_action),
  can_follow_up,
  is_waiting,
  is_validated,
  is_payer_validated,
  can_reopen: canReopen(contact),
  has_human_reply: c.human_reply === true,
  next_action,
  next_action_rule: rule,
  next_action_reason: reason
 };
}

// Programme-level roll-up. `payer_validated` counts only contacts that can answer a
// purchase question at all; a free product's maintainer cannot, so it is excluded by
// its stored flag rather than by whoever writes the summary.
export function summarize(contacts) {
 const derived = contacts.map(derive);
 const count = predicate => derived.filter(predicate).length;
 const byAction = {};
 for (const action of NEXT_ACTION) byAction[action] = count(d => d.next_action === action);
 return {
  contacts: derived.length,
  human_replies: count(d => d.has_human_reply),
  problem_validated: contacts.filter(c => c.validation.problem.status === POSITIVE).length,
  usefulness_validated: contacts.filter(c => c.validation.usefulness.status === POSITIVE).length,
  payer_validated: count(d => d.is_payer_validated),
  payer_countable: contacts.filter(c => c.counts_toward_payer_validation).length,
  waiting: count(d => d.is_waiting),
  needs_attention: count(d => d.needs_attention),
  by_next_action: byAction
 };
}
