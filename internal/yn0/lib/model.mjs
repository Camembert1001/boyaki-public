// YN0 validation state model: enums, record shape, and the invariants that keep
// conversation state and validation state from collapsing into each other.
//
// This module is YN0-only. It describes localization-preflight validation contacts
// and nothing else. BOYAKI state does not live here and must not be merged in:
// every record carries `program: "YN0"` and the loader rejects anything else.
//
// The single distinction this whole file exists to protect:
//
//   "we asked a question"   is NOT   "we should currently be waiting for its answer".
//
// A validation dimension sitting at UNKNOWN says only that we have no evidence.
// It says nothing about whether a reply is owed to us. Whether we are waiting is
// `conversation.waiting_for_reply`, and it is stored, not inferred from UNKNOWN.

export const SCHEMA = 'yn0-contact-state-v1';
export const PROGRAM = 'YN0';

// Evidence-backed answers to the four validation questions.
//   UNKNOWN   - no evidence either way. Never means "awaiting reply".
//   POSITIVE  - evidence says yes.
//   NEGATIVE  - evidence says no.
//   AMBIGUOUS - we have an answer and the answer does not resolve to yes or no.
export const VALIDATION_STATUS = ['UNKNOWN', 'POSITIVE', 'NEGATIVE', 'AMBIGUOUS'];

// The four things a contact can validate. `workflow` is hypothesis B: that the gap
// is not "no checker exists" but "the checker is never wired into release/CI".
export const VALIDATION_DIMENSIONS = ['problem', 'usefulness', 'workflow', 'payer'];

// Where the conversation itself stands. Orthogonal to the table above.
export const CONVERSATION_STATUS = [
 'DISCOVERED',     // identified as a candidate, nothing sent
 'CONTACTED',      // outreach sent, no reply expectation recorded yet
 'AWAITING_REPLY', // an answer is genuinely owed to us right now
 'REPLIED',        // a human wrote back and the ball is in our court
 'VALIDATING',     // an exchange is live and producing validation evidence
 'STALLED',        // the exchange ended without answers and we let it go
 'CLOSED',         // the exchange is finished; we do not re-open it ourselves
 'OBSERVE'         // no outreach relationship to manage; we watch the outcome
];

// What happened to our outreach. Separate from whether a human answered, so an
// automated support receipt can never be filed as a reply.
export const OUTREACH_STATUS = [
 'NOT_SENT',
 'SENT',
 'AUTO_ACK_ONLY',  // the only thing that came back was a bot/ticket receipt
 'FOLLOW_UP_SENT',
 'ANSWERED'        // a human answered, whatever the answer was
];

// Under what condition a finished conversation may become live again.
export const REOPEN_CONDITION = [
 'INBOUND_ONLY',   // only a new human inbound re-opens it; we never re-initiate
 'NEVER',
 'OPEN'            // ordinary live conversation, nothing to re-open
];

// The only values next_action may take. An LLM may explain one; it may not invent one.
export const NEXT_ACTION = [
 'WAIT',
 'FOLLOW_UP',
 'RESPOND',
 'DO_NOT_CONTACT',
 'CLOSE',
 'OBSERVE',
 'REVIEW'
];

export const CHANNEL = ['EMAIL', 'GITHUB_ISSUE', 'CONTACT_FORM', 'UNRECORDED'];
export const EVIDENCE_SOURCE = ['gmail', 'github', 'web_form', 'manual'];

// Conversation states in which we must not start an outbound message.
export const NO_INITIATE_STATUS = ['CLOSED', 'STALLED', 'OBSERVE'];
// Conversation states that are finished rather than live.
export const FINISHED_STATUS = ['CLOSED', 'STALLED'];

// Legal conversation_status moves. Re-entry to REPLIED from a finished state is
// the re-open path and is only reachable through recordHumanInbound().
export const ALLOWED_TRANSITIONS = {
 // First outreach normally carries the questions, so it lands straight in
 // AWAITING_REPLY. DISCOVERED cannot reach STALLED: nothing was ever started.
 DISCOVERED: ['CONTACTED', 'AWAITING_REPLY', 'OBSERVE', 'CLOSED'],
 CONTACTED: ['AWAITING_REPLY', 'REPLIED', 'STALLED', 'CLOSED', 'OBSERVE'],
 // CONTACTED is reachable back from the waiting states: it is where a contact lands
 // when we stop expecting an answer without closing the conversation.
 AWAITING_REPLY: ['CONTACTED', 'REPLIED', 'STALLED', 'CLOSED', 'OBSERVE'],
 REPLIED: ['VALIDATING', 'AWAITING_REPLY', 'CONTACTED', 'STALLED', 'CLOSED', 'OBSERVE'],
 VALIDATING: ['AWAITING_REPLY', 'REPLIED', 'CONTACTED', 'STALLED', 'CLOSED', 'OBSERVE'],
 STALLED: ['REPLIED', 'CLOSED', 'OBSERVE'],
 CLOSED: ['REPLIED', 'OBSERVE'],
 OBSERVE: ['REPLIED', 'CLOSED']
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oneOf = (value, allowed) => allowed.includes(value);
const isNullableDate = value => value === null || (typeof value === 'string' && ISO_DATE.test(value));

export function canTransition(from, to) {
 if (from === to) return true;
 return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

// Throws on an illegal conversation_status move. Transitions go through here so a
// contact can never be walked from CLOSED back into AWAITING_REPLY by hand.
export function assertTransition(from, to) {
 if (!oneOf(from, CONVERSATION_STATUS)) throw new Error('unknown conversation_status: ' + from);
 if (!oneOf(to, CONVERSATION_STATUS)) throw new Error('unknown conversation_status: ' + to);
 if (!canTransition(from, to)) throw new Error('illegal conversation transition: ' + from + ' -> ' + to);
 return to;
}

function validateEvidence(evidence, where, problems) {
 if (!isPlainObject(evidence)) return problems.push(where + ': evidence entry must be an object');
 if (!oneOf(evidence.source, EVIDENCE_SOURCE)) problems.push(where + ': unknown evidence source ' + JSON.stringify(evidence.source));
 // `ref` is the message id, issue URL or thread handle the claim can be traced to.
 // Explicit null is allowed and means "no stable identifier was captured"; it is a
 // recorded gap, not a licence to omit the field.
 if (!(evidence.ref === null || typeof evidence.ref === 'string')) problems.push(where + ': evidence.ref must be a string or null');
 if (typeof evidence.summary !== 'string' || evidence.summary.trim() === '') problems.push(where + ': evidence.summary is required');
 if (!(evidence.quote === undefined || typeof evidence.quote === 'string')) problems.push(where + ': evidence.quote must be a string when present');
 if (!isNullableDate(evidence.observed_at ?? null)) problems.push(where + ': evidence.observed_at must be an ISO date or null');
}

function validateValidation(validation, id, problems) {
 if (!isPlainObject(validation)) return problems.push(id + ': validation must be an object');
 const keys = Object.keys(validation).sort();
 if (String(keys) !== String([...VALIDATION_DIMENSIONS].sort())) {
  problems.push(id + ': validation must hold exactly ' + VALIDATION_DIMENSIONS.join(', '));
  return;
 }
 for (const dimension of VALIDATION_DIMENSIONS) {
  const cell = validation[dimension];
  const where = id + '.' + dimension;
  if (!isPlainObject(cell)) {
   problems.push(where + ': must be an object {status, evidence}');
   continue;
  }
  if (!oneOf(cell.status, VALIDATION_STATUS)) problems.push(where + ': unknown status ' + JSON.stringify(cell.status));
  if (!Array.isArray(cell.evidence)) {
   problems.push(where + ': evidence must be an array');
   continue;
  }
  cell.evidence.forEach((entry, i) => validateEvidence(entry, where + '.evidence[' + i + ']', problems));
  // The rule that keeps this file from becoming a guess log: anything other than
  // UNKNOWN is a claim about a human's answer, and a claim needs its source.
  if (cell.status !== 'UNKNOWN' && cell.evidence.length === 0) {
   problems.push(where + ': status ' + cell.status + ' requires at least one evidence entry');
  }
 }
}

function validateConversation(conversation, id, problems) {
 if (!isPlainObject(conversation)) return problems.push(id + ': conversation must be an object');
 const c = conversation;
 if (!oneOf(c.outreach_status, OUTREACH_STATUS)) problems.push(id + ': unknown outreach_status ' + JSON.stringify(c.outreach_status));
 if (typeof c.human_reply !== 'boolean') problems.push(id + ': human_reply must be a boolean');
 if (!oneOf(c.conversation_status, CONVERSATION_STATUS)) problems.push(id + ': unknown conversation_status ' + JSON.stringify(c.conversation_status));
 if (typeof c.waiting_for_reply !== 'boolean') problems.push(id + ': waiting_for_reply must be a boolean');
 if (typeof c.follow_up_allowed !== 'boolean') problems.push(id + ': follow_up_allowed must be a boolean');
 if (!oneOf(c.reopen_condition, REOPEN_CONDITION)) problems.push(id + ': unknown reopen_condition ' + JSON.stringify(c.reopen_condition));
 for (const field of ['last_inbound_at', 'last_outbound_at', 'last_auto_ack_at']) {
  if (!isNullableDate(c[field])) problems.push(id + ': ' + field + ' must be an ISO date or null');
 }

 // Invariants. Each one is a mistake this project actually made or nearly made.

 // AWAITING_REPLY is the name of "an answer is owed to us now". If nothing is owed,
 // the contact is not awaiting a reply, whatever questions were once sent.
 if (c.conversation_status === 'AWAITING_REPLY' && c.waiting_for_reply !== true) {
  problems.push(id + ': AWAITING_REPLY requires waiting_for_reply true');
 }
 if (c.waiting_for_reply === true && !['AWAITING_REPLY', 'VALIDATING'].includes(c.conversation_status)) {
  problems.push(id + ': waiting_for_reply true is only valid in AWAITING_REPLY or VALIDATING, not ' + c.conversation_status);
 }
 // A finished or observed conversation is not a queue we are sitting in, and not a
 // list we may mail again. This is what stops re-selling a CLOSED contact.
 if (NO_INITIATE_STATUS.includes(c.conversation_status)) {
  if (c.waiting_for_reply !== false) problems.push(id + ': ' + c.conversation_status + ' requires waiting_for_reply false');
  if (c.follow_up_allowed !== false) problems.push(id + ': ' + c.conversation_status + ' requires follow_up_allowed false');
 }
 if (FINISHED_STATUS.includes(c.conversation_status) && c.reopen_condition === 'OPEN') {
  problems.push(id + ': ' + c.conversation_status + ' cannot carry reopen_condition OPEN');
 }
 // An automated receipt is not a human answering. ANSWERED and AUTO_ACK_ONLY are
 // different outreach outcomes and the boolean must agree with the one recorded.
 if (c.outreach_status === 'ANSWERED' && c.human_reply !== true) {
  problems.push(id + ': outreach_status ANSWERED requires human_reply true');
 }
 if (c.outreach_status === 'AUTO_ACK_ONLY' && c.human_reply !== false) {
  problems.push(id + ': outreach_status AUTO_ACK_ONLY requires human_reply false');
 }
 if (c.outreach_status === 'NOT_SENT' && c.last_outbound_at !== null) {
  problems.push(id + ': outreach_status NOT_SENT cannot carry last_outbound_at');
 }
}

// Validates one stored contact record. Returns a list of problems; empty means valid.
export function validateContact(contact) {
 const problems = [];
 if (!isPlainObject(contact)) return ['contact must be an object'];
 const id = typeof contact.id === 'string' && contact.id ? contact.id : '<no id>';
 if (id === '<no id>') problems.push('contact.id is required');
 if (typeof contact.name !== 'string') problems.push(id + ': name must be a string');
 if (typeof contact.organization !== 'string') problems.push(id + ': organization must be a string');
 if (!oneOf(contact.channel, CHANNEL)) problems.push(id + ': unknown channel ' + JSON.stringify(contact.channel));
 // Free products cannot answer a purchase question, so they must not be able to
 // drift into the payer-validation count. The exclusion is stored, not inferred.
 if (typeof contact.counts_toward_payer_validation !== 'boolean') {
  problems.push(id + ': counts_toward_payer_validation must be a boolean');
 }
 if (!Array.isArray(contact.notes)) problems.push(id + ': notes must be an array');
 validateConversation(contact.conversation, id, problems);
 validateValidation(contact.validation, id, problems);
 return problems;
}

// Validates the whole store, including the YN0/BOYAKI separation.
export function validateStore(store) {
 const problems = [];
 if (!isPlainObject(store)) return ['store must be an object'];
 if (store.schema !== SCHEMA) problems.push('store.schema must be ' + SCHEMA);
 if (store.program !== PROGRAM) problems.push('store.program must be ' + PROGRAM);
 if (!Array.isArray(store.contacts)) return problems.concat('store.contacts must be an array');
 const seen = new Set();
 for (const contact of store.contacts) {
  if (isPlainObject(contact) && contact.program !== PROGRAM) {
   problems.push((contact.id || '<no id>') + ': contact.program must be ' + PROGRAM + ' (this store is YN0-only)');
  }
  if (isPlainObject(contact) && typeof contact.id === 'string') {
   if (seen.has(contact.id)) problems.push('duplicate contact id: ' + contact.id);
   seen.add(contact.id);
  }
  problems.push(...validateContact(contact));
 }
 return problems;
}
