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

// Identity evidence: the exact public handles by which this contact can be recognized
// again. It exists for one question only - "is this discovered party somebody we have
// already written to?" - and it answers that question the only way that is safe to
// automate: by exact equality on an identifier the contact actually owns.
//
// Every field is a list of *identifiers*, never a description. Nothing here is a
// similarity score, and nothing downstream may turn it into one: a shared first name, a
// shared organization, an overlapping username fragment or a similar project are not
// evidence that two parties are the same, and a matcher that treated them as such would
// merge two strangers into one record. The opposite mistake - failing to recognize a
// contact we have already burned - is worse still, which is why a contact that carries
// no identity at all is *opaque*: a store holding one cannot truthfully answer "no
// match" about anybody. See identityKeys() and the coverage rule in the prospect layer.
export const IDENTITY_FIELDS = ['github_logins', 'repositories', 'aliases', 'emails', 'domains', 'manual_links'];

// The singular kind each field contributes to a match key. `kind:value` is what a
// matcher compares, so the vocabulary is fixed here rather than at the comparison site.
export const IDENTITY_KINDS = {
 github_logins: 'github_login',
 repositories: 'repository',
 aliases: 'alias',
 emails: 'email',
 domains: 'domain',
 manual_links: 'manual_link'
};

const GITHUB_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
const REPOSITORY = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}\/[a-z0-9._-]{1,100}$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CANDIDATE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

// Free-text identity (a project title, a handle as it is written on a store page) folded
// to the form two spellings of the same name share. NFKC first so full-width and
// half-width Japanese compare equal; letters and digits of every script survive.
export const normalizeAlias = value =>
 String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const normalizeLogin = value => String(value ?? '').trim().toLowerCase().replace(/^@/, '');

// A repository is only an identity in `owner/name` form. A bare repository name is not:
// two unrelated parties both having a repository called `game` says nothing about either.
export function normalizeRepository(value) {
 let text = String(value ?? '').trim().toLowerCase();
 text = text.replace(/^\/+/, '').replace(/\/+$/, '');
 return text.endsWith('.git') ? text.slice(0, -4) : text;
}

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

export function emptyIdentity() {
 return Object.fromEntries(IDENTITY_FIELDS.map(field => [field, []]));
}

// Each field is validated for *shape*, because a malformed identifier is worse than an
// absent one: it silently never matches, and a contact that never matches is a contact
// the discovery layer will happily report as a stranger.
const IDENTITY_RULES = {
 github_logins: {normalize: normalizeLogin, pattern: GITHUB_LOGIN, hint: 'a GitHub login like octocat (no @, no slash)'},
 repositories: {normalize: normalizeRepository, pattern: REPOSITORY, hint: 'a repository in owner/name form'},
 aliases: {normalize: normalizeAlias, pattern: null, hint: 'a non-empty name'},
 // The hints avoid spelling out an example address or host: a test asserts that no
 // tracked file in this directory carries anything shaped like contact data, and it is
 // right to refuse even an invented one.
 emails: {normalize: value => String(value ?? '').trim().toLowerCase(), pattern: EMAIL, hint: 'an address in local-part, at-sign, host form'},
 domains: {normalize: value => String(value ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), pattern: DOMAIN, hint: 'a bare host, with no scheme and no path'},
 manual_links: {normalize: value => String(value ?? '').trim().toLowerCase(), pattern: CANDIDATE_ID, hint: 'a candidate id as a manifest spells it'}
};

export function normalizeIdentity(raw, label = 'identity') {
 if (raw === undefined || raw === null) return emptyIdentity();
 if (typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must be an object');
 for (const key of Object.keys(raw)) {
  if (!IDENTITY_FIELDS.includes(key)) {
   fail(label + ' has unknown field ' + JSON.stringify(key) + '; known fields are ' + IDENTITY_FIELDS.join(', '));
  }
 }
 const identity = emptyIdentity();
 for (const field of IDENTITY_FIELDS) {
  const values = raw[field];
  if (values === undefined || values === null) continue;
  if (!Array.isArray(values)) fail(label + '.' + field + ' must be an array of strings');
  const rule = IDENTITY_RULES[field];
  const seen = new Set();
  for (const [index, value] of values.entries()) {
   const where = label + '.' + field + '[' + index + ']';
   if (typeof value !== 'string') fail(where + ' must be a string');
   const normalized = rule.normalize(value);
   if (normalized === '') fail(where + ' must not be empty');
   if (rule.pattern && !rule.pattern.test(normalized)) {
    fail(where + ' must be ' + rule.hint + ' (got ' + JSON.stringify(value) + ')');
   }
   seen.add(normalized);
  }
  identity[field] = [...seen].sort();
 }
 return identity;
}

// Every identifier this contact claims, as `kind:value`. An empty list means the contact
// is *opaque*: nothing about it can be recognized in public, so no automatic lookup may
// report "this party is not in the store" without excluding it by hand first.
export function identityKeys(contact) {
 const identity = contact.identity ?? emptyIdentity();
 const keys = [];
 for (const field of IDENTITY_FIELDS) {
  for (const value of identity[field] ?? []) keys.push(IDENTITY_KINDS[field] + ':' + value);
 }
 return keys.sort();
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

// `who` is the identity half of a contact record: who they are and where the thread is,
// including the optional `identity` block of public identifiers they can be recognized by.
export function createContact(who) {
 if (!who || typeof who !== 'object') fail('identity must be an object');
 return {
  id: assertString(who.id, 'id'),
  name: who.name === undefined || who.name === null ? null : assertString(who.name, 'name'),
  organization: who.organization === undefined || who.organization === null ? null : assertString(who.organization, 'organization'),
  channel: assertEnum(who.channel ?? 'OTHER', CHANNELS, 'channel'),
  channel_ref: who.channel_ref === undefined || who.channel_ref === null ? null : assertString(who.channel_ref, 'channel_ref'),
  identity: normalizeIdentity(who.identity, 'identity'),
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
