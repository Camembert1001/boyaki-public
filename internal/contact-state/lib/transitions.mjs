// Transitions for the YN0 contact state machine.
//
// Events are the log of what happened; the contact record is the fold over them.
// Two rules carry most of the weight:
//
//  1. Recording a validation answer NEVER touches the conversation block, and
//     sending a question NEVER touches the validation block. "We asked" and
//     "we are owed an answer" are different facts, and so are "we asked" and
//     "we learned something".
//  2. Outbound events are refused - loudly - when the conversation does not
//     entitle us to send anything (CLOSED, opted out, or after we told the
//     person they need not reply). Nothing here sends mail; refusing is how the
//     model prevents an operator from queueing a follow-up that should not exist.
import {
 ContactStateError,
 VALIDATION_AXES,
 VALIDATION_STATUSES,
 WAITING_FOR,
 assertEnum,
 assertInstant,
 cloneContact,
 createContact,
 isBefore,
 normalizeEvidence,
 requireEvidence
} from './model.mjs';

export const EVENT_TYPES = [
 'OUTREACH_SENT',
 'QUESTION_SENT',
 'FOLLOW_UP_SENT',
 'INBOUND_REPLY',
 'REPLY_WAIVED',
 'NO_REPLY_TIMEOUT',
 'CONVERSATION_ENDED',
 'OPT_OUT',
 'VALIDATION_RECORDED'
];

// Events that put a message on the wire. All of them go through canSend().
const OUTBOUND = ['OUTREACH_SENT', 'QUESTION_SENT', 'FOLLOW_UP_SENT', 'REPLY_WAIVED'];

function fail(message) {
 throw new ContactStateError(message);
}

// Why an outbound event is (not) allowed right now. The refusal text is meant to be
// read by whoever typed the event, so it names the blocking field.
export function canSend(contact, type) {
 const c = contact.conversation;
 if (c.conversation_status === 'CLOSED') {
  return {ok: false, reason: 'contact is CLOSED (reopen_condition=' + c.reopen_condition + '); only an inbound message may restart it'};
 }
 if (c.reopen_condition === 'NEVER') {
  return {ok: false, reason: 'contact opted out (reopen_condition=NEVER)'};
 }
 if (type === 'REPLY_WAIVED') return {ok: true, reason: null};
 if (c.reply_waived) {
  return {ok: false, reason: 'we already told this contact that no reply is needed (reply_waived=true)'};
 }
 if (type === 'OUTREACH_SENT' && c.outreach_status === 'SENT') {
  return {ok: false, reason: 'first outreach already sent; use FOLLOW_UP_SENT'};
 }
 if (type !== 'OUTREACH_SENT' && c.outreach_status !== 'SENT') {
  return {ok: false, reason: 'no outreach has been sent yet (outreach_status=' + c.outreach_status + ')'};
 }
 if (type === 'FOLLOW_UP_SENT' && !c.follow_up_allowed) {
  return {ok: false, reason: 'follow_up_allowed=false'};
 }
 return {ok: true, reason: null};
}

function applyOutbound(next, at) {
 next.conversation.last_outbound_at = at;
 next.conversation.outreach_status = 'SENT';
}

function applyValidation(next, event) {
 const axis = assertEnum(event.axis, VALIDATION_AXES, 'event.axis');
 const status = assertEnum(event.status, VALIDATION_STATUSES, 'event.status');
 const evidence = (event.evidence ?? []).map((item, index) => normalizeEvidence(item, 'event.evidence[' + index + ']'));
 requireEvidence(status, evidence, axis);
 next.validation[axis] = {status, evidence};
}

// Apply one event and return a new record. Never mutates its input.
export function applyEvent(contact, event) {
 if (!event || typeof event !== 'object' || Array.isArray(event)) fail('event must be an object');
 const type = assertEnum(event.type, EVENT_TYPES, 'event.type');
 const next = cloneContact(contact);
 const c = next.conversation;

 if (type === 'VALIDATION_RECORDED') {
  // Deliberately no conversation write of any kind.
  applyValidation(next, event);
  return next;
 }

 const at = assertInstant(event.at, 'event.at');
 if (isBefore(at, c.last_inbound_at) || isBefore(at, c.last_outbound_at)) {
  fail(type + ' at ' + at + ' is older than the contact\'s last recorded message');
 }
 if (OUTBOUND.includes(type)) {
  const verdict = canSend(next, type);
  if (!verdict.ok) fail(type + ' refused for ' + next.id + ': ' + verdict.reason);
 }

 switch (type) {
  case 'OUTREACH_SENT': {
   const expectsReply = event.expects_reply ?? true;
   applyOutbound(next, at);
   c.conversation_status = expectsReply ? 'AWAITING_REPLY' : 'CONTACTED';
   c.waiting_for = expectsReply ? assertEnum(event.waiting_for ?? 'FIRST_REPLY', WAITING_FOR, 'event.waiting_for') : 'NOTHING';
   c.waiting_for_reply = Boolean(expectsReply);
   c.follow_up_allowed = true;
   c.reopen_condition = 'NOT_APPLICABLE';
   break;
  }
  case 'QUESTION_SENT': {
   const waitingFor = assertEnum(event.waiting_for ?? 'VALIDATION_ANSWER', WAITING_FOR, 'event.waiting_for');
   if (waitingFor === 'NOTHING') fail('QUESTION_SENT.waiting_for must name what the answer would answer');
   applyOutbound(next, at);
   c.conversation_status = 'VALIDATING';
   c.waiting_for = waitingFor;
   c.waiting_for_reply = true;
   c.follow_up_allowed = true;
   break;
  }
  case 'FOLLOW_UP_SENT': {
   applyOutbound(next, at);
   const waitingFor = assertEnum(event.waiting_for ?? (c.waiting_for === 'NOTHING' ? 'FIRST_REPLY' : c.waiting_for), WAITING_FOR, 'event.waiting_for');
   c.conversation_status = waitingFor === 'FIRST_REPLY' ? 'AWAITING_REPLY' : 'VALIDATING';
   c.waiting_for = waitingFor;
   c.waiting_for_reply = true;
   c.reopen_condition = 'NOT_APPLICABLE';
   break;
  }
  case 'REPLY_WAIVED': {
   // "You do not need to answer this." Releases them, and releases us from the
   // idea that an answer is still coming.
   applyOutbound(next, at);
   c.reply_waived = true;
   c.waiting_for_reply = false;
   c.waiting_for = 'NOTHING';
   c.follow_up_allowed = false;
   break;
  }
  case 'INBOUND_REPLY': {
   const human = event.human ?? true;
   c.last_inbound_at = at;
   if (human) c.human_reply = true;
   if (c.reopen_condition === 'NEVER') {
    // An opted-out contact writing to us is a human decision, not a reopen.
    c.inbound_since_close = true;
    break;
   }
   c.conversation_status = 'REPLIED';
   c.waiting_for = 'NOTHING';
   c.waiting_for_reply = false;
   c.reply_waived = false;
   c.follow_up_allowed = true;
   c.reopen_condition = 'NOT_APPLICABLE';
   c.closed_reason = null;
   c.inbound_since_close = false;
   break;
  }
  case 'NO_REPLY_TIMEOUT': {
   if (c.conversation_status === 'DISCOVERED') fail('NO_REPLY_TIMEOUT before any outreach');
   if (c.conversation_status === 'CLOSED') fail('NO_REPLY_TIMEOUT on a CLOSED contact');
   c.conversation_status = 'STALLED';
   c.waiting_for = 'NOTHING';
   c.waiting_for_reply = false;
   // If we told them not to answer, silence is the outcome we asked for, not an
   // opening for a follow-up.
   c.follow_up_allowed = !c.reply_waived;
   c.reopen_condition = 'INBOUND_ONLY';
   break;
  }
  case 'CONVERSATION_ENDED': {
   const direction = assertEnum(event.direction ?? 'inbound', ['inbound', 'outbound'], 'event.direction');
   if (direction === 'inbound') c.last_inbound_at = at;
   else c.last_outbound_at = at;
   if (direction === 'inbound' && (event.human ?? true)) c.human_reply = true;
   c.conversation_status = 'CLOSED';
   c.waiting_for = 'NOTHING';
   c.waiting_for_reply = false;
   c.follow_up_allowed = false;
   c.reopen_condition = 'INBOUND_ONLY';
   c.closed_reason = event.reason ?? null;
   break;
  }
  case 'OPT_OUT': {
   c.last_inbound_at = at;
   c.human_reply = true;
   c.conversation_status = 'CLOSED';
   c.waiting_for = 'NOTHING';
   c.waiting_for_reply = false;
   c.follow_up_allowed = false;
   c.reopen_condition = 'NEVER';
   c.closed_reason = event.reason ?? 'opted out';
   break;
  }
  default:
   fail('unhandled event type: ' + type);
 }
 return next;
}

// Fold an ordered event log into a contact record.
export function replay(identity, events = []) {
 if (!Array.isArray(events)) fail('events must be an array');
 let contact = createContact(identity);
 let previousAt = null;
 for (const [index, event] of events.entries()) {
  if (event && event.at !== undefined && event.at !== null) {
   const at = assertInstant(event.at, 'events[' + index + '].at');
   if (previousAt !== null && isBefore(at, previousAt)) {
    fail('events[' + index + '] (' + event.type + ' at ' + at + ') is out of chronological order');
   }
   previousAt = at;
  }
  try {
   contact = applyEvent(contact, event);
  } catch (error) {
   if (error instanceof ContactStateError) fail('events[' + index + ']: ' + error.message);
   throw error;
  }
 }
 return contact;
}
