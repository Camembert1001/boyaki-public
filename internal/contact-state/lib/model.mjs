// Record shape for the YN0 contact state machine.
//
// One contact = one identity + two *separate* state blocks:
//
//   conversation - what happened on the wire (mail / issue thread) and whether we
//                  are entitled to send anything next.
//   validation   - what we have actually learned, each axis with its evidence.
//
// They are separate on purpose. `payer: UNKNOWN` is a statement about knowledge; it
// says nothing about whether a reply is owed. Only `conversation` decides that.
//
// No clock is read anywhere in this module or its siblings: every timestamp comes
// from an event, so the same input always produces the same output.

export const SCHEMA = 'yn0-contact-state-v1';

export const CHANNELS = ['GMAIL', 'GITHUB_ISSUE', 'GITHUB_COMMENT', 'OTHER'];

export const OUTREACH_STATUSES = ['NOT_SENT', 'SENT', 'FAILED'];

export const CONVERSATION_STATUSES = [
 'DISCOVERED',     // known prospect, nothing sent
 'CONTACTED',      // we sent something that did not ask for an answer
 'AWAITING_REPLY', // we asked, no human reply yet
 'REPLIED',        // a human answered; the ball is on our side
 'VALIDATING',     // a validation / payer question is outstanding
 'STALLED',        // the thread ran out without an answer
 'CLOSED'          // the conversation is over
];

// What, concretely, an outstanding answer would be an answer *to*. NOTHING is the
// only value compatible with waiting_for_reply === false.
export const WAITING_FOR = ['NOTHING', 'FIRST_REPLY', 'VALIDATION_ANSWER', 'PAYER_ANSWER'];

// Under what condition a finished conversation may become active again.
export const REOPEN_CONDITIONS = [
 'NOT_APPLICABLE', // still live
 'INBOUND_ONLY',   // only if they write to us first
 'NEVER'           // opted out
];

// The four things a contact can teach us. They double as the possible values of
// `waiting_for_axis`: "waiting on the workflow question" and "waiting on the price
// question" are different waits, and reading one as the other is the same class of
// mistake this module exists to stop.
export const VALIDATION_AXES = ['problem', 'usefulness', 'workflow', 'payer'];

export const VALIDATION_STATUSES = ['UNKNOWN', 'POSITIVE', 'NEGATIVE', 'AMBIGUOUS'];

// Anything other than UNKNOWN is a claim about a person, so it must cite something
// they actually wrote. See requireEvidence below.
export const EVIDENCE_SOURCES = ['gmail', 'github_issue', 'github_comment', 'other'];

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export class ContactStateError extends Error {}

function fail(message) {
 throw new ContactStateError(message);
}

export function assertEnum(value, allowed, label) {
 if (!allowed.includes(value)) fail(label + ' must be one of ' + allowed.join(', ') + ' (got ' + JSON.stringify(value) + ')');
 return value;
}

export function assertInstant(value, label) {
 if (typeof value !== 'string' || !ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
  fail(label + ' must be an ISO 8601 UTC instant like 2026-09-18T09:00:00Z (got ' + JSON.stringify(value) + ')');
 }
 return value;
}

function assertString(value, label) {
 if (typeof value !== 'string' || value.trim() === '') fail(label + ' must be a non-empty string');
 return value;
}

export function isBefore(a, b) {
 if (a === null || b === null) return false;
 return Date.parse(a) < Date.parse(b);
}

// One piece of evidence for one validation axis. `quote_or_summary` is what the
// person said, quoted or summarised - never our interpretation of it.
export function normalizeEvidence(raw, label) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must be an object');
 return {
  source: assertEnum(raw.source, EVIDENCE_SOURCES, label + '.source'),
  message_id: raw.message_id === undefined || raw.message_id === null ? null : assertString(raw.message_id, label + '.message_id'),
  quote_or_summary: assertString(raw.quote_or_summary, label + '.quote_or_summary'),
  observed_at: raw.observed_at === undefined || raw.observed_at === null ? null : assertInstant(raw.observed_at, label + '.observed_at')
 };
}

export function normalizeValidation(raw, axis) {
 const label = 'validation.' + axis;
 if (raw === undefined || raw === null) return {status: 'UNKNOWN', evidence: []};
 if (typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must be an object');
 const status = assertEnum(raw.status ?? 'UNKNOWN', VALIDATION_STATUSES, label + '.status');
 const evidence = (raw.evidence ?? []).map((item, index) => normalizeEvidence(item, label + '.evidence[' + index + ']'));
 return {status, evidence};
}

// A judgement without a citation is a guess. Guesses are not allowed to leave UNKNOWN.
export function requireEvidence(status, evidence, axis) {
 if (status !== 'UNKNOWN' && evidence.length === 0) {
  fail('validation.' + axis + ' = ' + status + ' requires at least one evidence entry');
 }
}

export function emptyValidation() {
 return Object.fromEntries(VALIDATION_AXES.map(axis => [axis, {status: 'UNKNOWN', evidence: []}]));
}

export function emptyConversation() {
 return {
  outreach_status: 'NOT_SENT',
  human_reply: false,
  conversation_status: 'DISCOVERED',
  waiting_for: 'NOTHING',
  waiting_for_axis: null, // which validation axis the outstanding answer would settle
  waiting_for_reply: false,
  reply_waived: false,   // we told them an answer is not needed
  follow_up_allowed: false,
  reopen_condition: 'NOT_APPLICABLE',
  closed_reason: null,
  inbound_since_close: false, // an opted-out contact wrote to us; a human must look
  last_inbound_at: null,      // last message from a *person*; never an autoresponder
  last_auto_inbound_at: null, // last automated acknowledgement, which is not a reply
  last_outbound_at: null
 };
}

export function createContact(identity) {
 if (!identity || typeof identity !== 'object') fail('identity must be an object');
 return {
  id: assertString(identity.id, 'id'),
  name: identity.name === undefined || identity.name === null ? null : assertString(identity.name, 'name'),
  organization: identity.organization === undefined || identity.organization === null ? null : assertString(identity.organization, 'organization'),
  channel: assertEnum(identity.channel ?? 'OTHER', CHANNELS, 'channel'),
  channel_ref: identity.channel_ref === undefined || identity.channel_ref === null ? null : assertString(identity.channel_ref, 'channel_ref'),
  conversation: emptyConversation(),
  validation: emptyValidation()
 };
}

export function normalizeContact(raw) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('contact must be an object');
 const contact = createContact(raw);
 const conversation = raw.conversation ?? {};
 if (typeof conversation !== 'object' || Array.isArray(conversation)) fail('conversation must be an object');
 const base = contact.conversation;
 contact.conversation = {
  outreach_status: assertEnum(conversation.outreach_status ?? base.outreach_status, OUTREACH_STATUSES, 'conversation.outreach_status'),
  human_reply: Boolean(conversation.human_reply ?? base.human_reply),
  conversation_status: assertEnum(conversation.conversation_status ?? base.conversation_status, CONVERSATION_STATUSES, 'conversation.conversation_status'),
  waiting_for: assertEnum(conversation.waiting_for ?? base.waiting_for, WAITING_FOR, 'conversation.waiting_for'),
  waiting_for_axis: conversation.waiting_for_axis === undefined || conversation.waiting_for_axis === null
   ? base.waiting_for_axis
   : assertEnum(conversation.waiting_for_axis, VALIDATION_AXES, 'conversation.waiting_for_axis'),
  waiting_for_reply: Boolean(conversation.waiting_for_reply ?? base.waiting_for_reply),
  reply_waived: Boolean(conversation.reply_waived ?? base.reply_waived),
  follow_up_allowed: Boolean(conversation.follow_up_allowed ?? base.follow_up_allowed),
  reopen_condition: assertEnum(conversation.reopen_condition ?? base.reopen_condition, REOPEN_CONDITIONS, 'conversation.reopen_condition'),
  inbound_since_close: Boolean(conversation.inbound_since_close ?? base.inbound_since_close),
  closed_reason: conversation.closed_reason === undefined || conversation.closed_reason === null ? null : assertString(conversation.closed_reason, 'conversation.closed_reason'),
  last_inbound_at: conversation.last_inbound_at === undefined || conversation.last_inbound_at === null ? null : assertInstant(conversation.last_inbound_at, 'conversation.last_inbound_at'),
  last_auto_inbound_at: conversation.last_auto_inbound_at === undefined || conversation.last_auto_inbound_at === null ? null : assertInstant(conversation.last_auto_inbound_at, 'conversation.last_auto_inbound_at'),
  last_outbound_at: conversation.last_outbound_at === undefined || conversation.last_outbound_at === null ? null : assertInstant(conversation.last_outbound_at, 'conversation.last_outbound_at')
 };
 const validation = raw.validation ?? {};
 if (typeof validation !== 'object' || Array.isArray(validation)) fail('validation must be an object');
 for (const key of Object.keys(validation)) {
  if (!VALIDATION_AXES.includes(key)) fail('unknown validation axis: ' + key);
 }
 contact.validation = Object.fromEntries(VALIDATION_AXES.map(axis => [axis, normalizeValidation(validation[axis], axis)]));
 return contact;
}

export function cloneContact(contact) {
 return structuredClone(contact);
}
