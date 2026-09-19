// Tests for the YN0 validation state machine. Run with:
//   node --test internal/yn0/tests/state.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 CONVERSATION_STATUS, NEXT_ACTION, VALIDATION_STATUS, canTransition, validateContact, validateStore
} from '../lib/model.mjs';
import {derive, deriveNextAction, summarize} from '../lib/derive.mjs';
import {
 allowFollowUp, closeConversation, observeOnly, recordAutoAck, recordHumanInbound,
 recordOutboundQuestion, recordOutreach, recordValidation, releaseWaiting, stallConversation
} from '../lib/transitions.mjs';
import {loadStore, parseStore, renderText, report, STORE_PATH} from '../lib/store.mjs';
import {parseArgs} from '../state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');

const store = await loadStore();
const byId = Object.fromEntries(store.contacts.map(contact => [contact.id, contact]));
const actionOf = id => derive(byId[id]).next_action;

// A freshly discovered contact: nothing sent, nothing known, nothing owed.
const seed = (id = 'fixture') => ({
 id,
 program: 'YN0',
 name: 'Fixture',
 organization: 'Fixture Studio',
 channel: 'EMAIL',
 counts_toward_payer_validation: true,
 conversation: {
  outreach_status: 'NOT_SENT',
  human_reply: false,
  conversation_status: 'DISCOVERED',
  waiting_for_reply: false,
  follow_up_allowed: false,
  reopen_condition: 'OPEN',
  last_inbound_at: null,
  last_outbound_at: null,
  last_auto_ack_at: null
 },
 validation: {
  problem: {status: 'UNKNOWN', evidence: []},
  usefulness: {status: 'UNKNOWN', evidence: []},
  workflow: {status: 'UNKNOWN', evidence: []},
  payer: {status: 'UNKNOWN', evidence: []}
 },
 notes: []
});

const evidence = summary => ({source: 'gmail', ref: null, summary, observed_at: null});

// ---------------------------------------------------------------- required cases

test('1. outreach sent and no human reply yet leaves the contact AWAITING_REPLY', () => {
 const contact = recordOutreach(seed(), {at: '2026-09-01'});
 assert.equal(contact.conversation.conversation_status, 'AWAITING_REPLY');
 assert.equal(contact.conversation.human_reply, false);
 const d = derive(contact);
 assert.equal(d.is_waiting, true);
 assert.equal(d.next_action, 'WAIT');
});

test('2. a usefulness YES with no payer answer leaves usefulness POSITIVE and payer UNKNOWN', () => {
 let contact = recordHumanInbound(recordOutreach(seed()), {at: '2026-09-02'});
 contact = recordValidation(contact, 'usefulness', 'POSITIVE', evidence('Said the mechanical check would be useful before import.'));
 assert.equal(contact.validation.usefulness.status, 'POSITIVE');
 assert.equal(contact.validation.payer.status, 'UNKNOWN');
 assert.equal(contact.validation.payer.evidence.length, 0);
 // A useful-yes is not a payer-yes, and the roll-up must not borrow one for the other.
 assert.equal(derive(contact).is_payer_validated, false);
});

test('3. an explicit $5 purchase YES is payer POSITIVE with its evidence attached', () => {
 const quote = {source: 'gmail', ref: null, summary: 'Would buy for $5', quote: 'Yes, I would pay $5 for that.', observed_at: null};
 const contact = recordValidation(recordHumanInbound(recordOutreach(seed())), 'payer', 'POSITIVE', quote);
 assert.equal(contact.validation.payer.status, 'POSITIVE');
 assert.deepEqual(contact.validation.payer.evidence, [quote]);
 assert.equal(derive(contact).is_payer_validated, true);
});

test('4. a clear "we do not need this" answer is NEGATIVE, not UNKNOWN', () => {
 const contact = recordValidation(
  recordHumanInbound(recordOutreach(seed())),
  'usefulness',
  'NEGATIVE',
  evidence('Said their existing QA pass already catches this and the check would add nothing.')
 );
 assert.equal(contact.validation.usefulness.status, 'NEGATIVE');
 assert.equal(derive(contact).is_validated, false);
});

test('5. Muraoka: payer UNKNOWN, not waiting, DO_NOT_CONTACT', () => {
 const muraoka = byId['muraoka-collet'];
 const d = derive(muraoka);
 assert.equal(muraoka.validation.payer.status, 'UNKNOWN');
 assert.equal(muraoka.conversation.waiting_for_reply, false);
 assert.equal(d.is_waiting, false);
 assert.equal(d.next_action, 'DO_NOT_CONTACT');
 assert.equal(d.can_follow_up, false);
 // The regression this whole model exists to prevent: an UNKNOWN payer answer
 // reading as "payer validation reply pending".
 assert.notEqual(muraoka.conversation.conversation_status, 'AWAITING_REPLY');
 assert.equal(summarize([muraoka]).waiting, 0);
});

test('6. Banzai: CLOSED, payer AMBIGUOUS with the non-answer quoted, DO_NOT_CONTACT', () => {
 const banzai = byId['banzai-escape-2'];
 const d = derive(banzai);
 assert.equal(banzai.conversation.conversation_status, 'CLOSED');
 assert.equal(banzai.validation.payer.status, 'AMBIGUOUS');
 assert.equal(banzai.validation.payer.evidence[0].quote, "That. I don't know. I cannot answer YEs or No.");
 assert.equal(banzai.validation.usefulness.status, 'POSITIVE');
 assert.equal(d.next_action, 'DO_NOT_CONTACT');
 assert.equal(d.is_waiting, false);
 assert.equal(d.can_follow_up, false);
 assert.equal(d.is_payer_validated, false);
});

test('7. Atlos: usefulness POSITIVE, payer UNKNOWN, AWAITING_REPLY on the open follow-up', () => {
 const atlos = byId['atlos-open-endfield-map'];
 const d = derive(atlos);
 assert.equal(atlos.validation.problem.status, 'POSITIVE');
 assert.equal(atlos.validation.usefulness.status, 'POSITIVE');
 assert.equal(atlos.validation.payer.status, 'UNKNOWN');
 assert.equal(atlos.conversation.conversation_status, 'AWAITING_REPLY');
 assert.equal(d.is_waiting, true);
 assert.equal(d.is_validated, true);
 assert.equal(d.is_payer_validated, false);
 assert.equal(d.next_action, 'WAIT');
});

test('8. an automated receipt is not a human reply', () => {
 const contact = recordAutoAck(recordOutreach(seed(), {at: '2026-09-01'}), {at: '2026-09-01'});
 assert.equal(contact.conversation.human_reply, false);
 assert.equal(contact.conversation.outreach_status, 'AUTO_ACK_ONLY');
 assert.equal(contact.conversation.last_inbound_at, null, 'an auto-ack must not fill the human inbound timestamp');
 assert.equal(contact.conversation.last_auto_ack_at, '2026-09-01');
 assert.equal(derive(contact).has_human_reply, false);
 assert.equal(derive(contact).next_action, 'WAIT');
 // Aseprite is exactly this shape on the live store.
 assert.equal(byId['aseprite-igara'].conversation.human_reply, false);
 assert.equal(byId['aseprite-igara'].conversation.outreach_status, 'AUTO_ACK_ONLY');
});

test('9. a new human inbound re-opens a CLOSED contact, and only an inbound can', () => {
 const closed = closeConversation(recordHumanInbound(recordOutreach(seed()), {at: '2026-09-02'}), {reopen: 'INBOUND_ONLY'});
 assert.equal(derive(closed).next_action, 'DO_NOT_CONTACT');
 assert.equal(derive(closed).can_reopen, true);

 const reopened = recordHumanInbound(closed, {at: '2026-09-10'});
 assert.equal(reopened.conversation.conversation_status, 'REPLIED');
 assert.equal(reopened.conversation.human_reply, true);
 assert.equal(derive(reopened).next_action, 'RESPOND', 'their message is the last one, so the reply is owed by us');
 assert.equal(derive(reopened).needs_attention, true);

 // We may not re-open it ourselves: there is no transition out of CLOSED for us.
 assert.equal(canTransition('CLOSED', 'AWAITING_REPLY'), false);
 assert.throws(() => recordOutboundQuestion(closed), /illegal conversation transition: CLOSED -> AWAITING_REPLY/);
 assert.throws(() => allowFollowUp(closed), /invalid contact/);

 // NEVER means never, even for an inbound.
 const sealed = closeConversation(recordHumanInbound(recordOutreach(seed())), {reopen: 'NEVER'});
 assert.throws(() => recordHumanInbound(sealed), /cannot be re-opened/);
});

test('10. OyasumiVR is problem/usefulness evidence and is never counted as payer validation', () => {
 const oyasumi = byId['oyasumivr'];
 const d = derive(oyasumi);
 assert.equal(oyasumi.counts_toward_payer_validation, false);
 assert.equal(oyasumi.validation.problem.status, 'POSITIVE');
 assert.equal(oyasumi.validation.usefulness.status, 'POSITIVE');
 assert.equal(oyasumi.validation.payer.status, 'UNKNOWN');
 assert.equal(d.is_payer_validated, false);
 assert.equal(d.next_action, 'OBSERVE');

 // Even a POSITIVE payer answer from a free product stays out of the count.
 const hypothetical = recordValidation(oyasumi, 'payer', 'POSITIVE', evidence('Hypothetical yes from a free product.'));
 assert.equal(derive(hypothetical).is_payer_validated, false);
 assert.equal(summarize([hypothetical]).payer_validated, 0);
 assert.equal(summarize([hypothetical]).payer_countable, 0);
});

// ------------------------------------------------------- model and store guards

test('the live store is valid and every contact derives an in-enum next_action', () => {
 assert.deepEqual(validateStore(store), []);
 for (const contact of store.contacts) {
  const d = derive(contact);
  assert.ok(NEXT_ACTION.includes(d.next_action), contact.id + ': ' + d.next_action);
  assert.ok(CONVERSATION_STATUS.includes(contact.conversation.conversation_status), contact.id);
  for (const cell of Object.values(contact.validation)) assert.ok(VALIDATION_STATUS.includes(cell.status), contact.id);
 }
});

test('the current contacts hold their recorded next_action', () => {
 assert.deepEqual(
  Object.fromEntries(store.contacts.map(contact => [contact.id, actionOf(contact.id)])),
  {
   'banzai-escape-2': 'DO_NOT_CONTACT',
   'muraoka-collet': 'DO_NOT_CONTACT',
   'atlos-open-endfield-map': 'WAIT',
   'tashiro-across': 'WAIT',
   'sticky-paws-jonnil': 'WAIT',
   'aseprite-igara': 'WAIT',
   'oyasumivr': 'OBSERVE'
  }
 );
});

test('payer validation is not established by any contact in the store', () => {
 const summary = summarize(store.contacts);
 assert.equal(summary.payer_validated, 0, 'no contact has an evidence-backed $5 yes');
 assert.equal(summary.waiting, 4);
 assert.equal(summary.human_replies, 4);
 assert.equal(summary.by_next_action.DO_NOT_CONTACT, 2);
 assert.equal(summary.by_next_action.FOLLOW_UP, 0, 'nothing in the store may be followed up automatically');
});

test('a validation status other than UNKNOWN cannot be recorded without evidence', () => {
 const guessed = seed();
 guessed.validation.payer.status = 'POSITIVE';
 assert.match(validateContact(guessed).join('\n'), /payer: status POSITIVE requires at least one evidence entry/);
 assert.throws(() => recordValidation(seed(), 'payer', 'NEGATIVE', null), /requires evidence/);
});

test('"a question was sent" and "an answer is owed to us" are separate facts', () => {
 const asked = recordOutreach(seed(), {at: '2026-09-01'});
 assert.equal(asked.conversation.outreach_status, 'SENT');
 assert.equal(derive(asked).next_action, 'WAIT');

 // The Muraoka move: release the question without closing the conversation.
 const released = releaseWaiting(asked, {note: 'Told them they need not answer.'});
 assert.equal(released.conversation.outreach_status, 'SENT', 'the question is still on record as sent');
 assert.equal(released.conversation.waiting_for_reply, false);
 assert.equal(released.validation.payer.status, 'UNKNOWN');
 assert.equal(derive(released).is_waiting, false);
 assert.equal(derive(released).next_action, 'CLOSE', 'nothing is owed either way and no follow-up is allowed');

 // And the same store-level invariant, stated directly.
 const bad = recordOutreach(seed());
 bad.conversation.waiting_for_reply = false;
 assert.match(validateContact(bad).join('\n'), /AWAITING_REPLY requires waiting_for_reply true/);
});

test('an UNKNOWN validation answer never makes a contact waiting', () => {
 for (const contact of store.contacts) {
  const allUnknown = Object.values(contact.validation).every(cell => cell.status === 'UNKNOWN');
  if (!allUnknown) continue;
  // Tashiro and Sticky Paws are waiting because a question is outstanding; Muraoka
  // is not, although its validation table looks identical to theirs.
  assert.equal(
   derive(contact).is_waiting,
   contact.conversation.conversation_status === 'AWAITING_REPLY',
   contact.id + ': waiting must follow the conversation, not the validation table'
  );
 }
 assert.equal(derive(byId['muraoka-collet']).is_waiting, false);
 assert.equal(derive(byId['tashiro-across']).is_waiting, true);
});

test('a finished or observed contact can never be marked followable or waiting', () => {
 for (const status of ['CLOSED', 'STALLED', 'OBSERVE']) {
  const contact = seed();
  contact.conversation.conversation_status = status;
  contact.conversation.reopen_condition = 'INBOUND_ONLY';
  contact.conversation.follow_up_allowed = true;
  assert.match(validateContact(contact).join('\n'), new RegExp(status + ' requires follow_up_allowed false'));
 }
 const contacted = recordOutreach(seed());
 for (const contact of [stallConversation(contacted), closeConversation(contacted), observeOnly(contacted)]) {
  assert.equal(contact.conversation.follow_up_allowed, false);
  assert.equal(contact.conversation.waiting_for_reply, false);
  assert.equal(derive(contact).can_follow_up, false);
  assert.ok(['DO_NOT_CONTACT', 'OBSERVE'].includes(derive(contact).next_action));
 }
});

test('a follow-up is an explicit decision, never a derived permission', () => {
 const released = releaseWaiting(recordOutreach(seed()));
 assert.equal(derive(released).can_follow_up, false);
 const allowed = allowFollowUp(released, {note: 'One nudge approved by hand.'});
 assert.equal(derive(allowed).can_follow_up, true);
 assert.equal(derive(allowed).next_action, 'FOLLOW_UP');
 // Not while an answer is still owed to us.
 assert.throws(() => allowFollowUp(recordOutreach(seed())), /release the wait first/);
});

test('transitions do not mutate the record they are given', () => {
 const before = seed();
 const snapshot = JSON.stringify(before);
 recordOutreach(before);
 recordValidation(before, 'problem', 'POSITIVE', evidence('Confirmed the missing keys were real.'));
 assert.equal(JSON.stringify(before), snapshot);
});

test('the store is YN0-only and carries no BOYAKI state', async () => {
 const mixed = structuredClone(store);
 mixed.contacts.push({...seed('boyaki-thing'), program: 'BOYAKI'});
 assert.match(validateStore(mixed).join('\n'), /contact\.program must be YN0/);
 assert.throws(() => parseStore({...store, program: 'BOYAKI'}), /store\.program must be YN0/);

 // No contact record may carry BOYAKI data. (The store's own header note names
 // BOYAKI once, to say it is excluded; that is the separation, not a leak of it.)
 assert.equal(/boyaki/i.test(JSON.stringify(store.contacts)), false, 'no YN0 contact may reference BOYAKI state');
 for (const contact of store.contacts) assert.equal(contact.program, 'YN0', contact.id);

 // And nothing in the YN0 module reaches outside internal/yn0 for state.
 for (const file of ['lib/model.mjs', 'lib/derive.mjs', 'lib/transitions.mjs', 'lib/store.mjs', 'state.mjs']) {
  const source = await readFile(path.join(here, '..', file), 'utf8');
  assert.equal(/from '\.\.\/\.\.\//.test(source), false, file + ' must not import state from outside internal/yn0');
 }
});

test('the reader is read-only and deterministic', async () => {
 const before = await readFile(STORE_PATH, 'utf8');
 const first = renderText(store);
 const second = renderText(await loadStore());
 assert.equal(first, second);
 assert.equal(JSON.stringify(report(store)), JSON.stringify(report(await loadStore())));
 assert.equal(first.includes('generatedAt'), false, 'the rendered state must not carry a timestamp');
 assert.equal(await readFile(STORE_PATH, 'utf8'), before, 'reading the store must not rewrite it');
});

test('the checkpoint records the same state the machine derives', async () => {
 const checkpoint = await readFile(path.join(here, '..', 'CHECKPOINT.md'), 'utf8');
 assert.match(checkpoint, /^# YN0 Checkpoint/m);
 assert.match(checkpoint, /Payer:\s*\n+NOT VALIDATED/);
 // The payer count quoted in the prose has to be the count the machine derives, so
 // the checkpoint cannot drift into reading as though payer validation succeeded.
 const summary = summarize(store.contacts);
 assert.equal(summary.payer_validated, 0);
 assert.ok(
  checkpoint.includes('payer validated ' + summary.payer_validated + '/' + summary.payer_countable + ' countable'),
  'the checkpoint must quote the derived payer count'
 );
 for (const contact of store.contacts) {
  assert.ok(checkpoint.includes(contact.name) || checkpoint.includes(contact.organization), contact.id + ' missing from the checkpoint');
  assert.ok(checkpoint.includes(actionOf(contact.id)), contact.id + ': next_action missing from the checkpoint');
 }
});

test('CLI argument parsing', () => {
 assert.deepEqual(parseArgs(['--format', 'json']).format, 'json');
 assert.equal(parseArgs(['--check']).check, true);
 assert.equal(parseArgs(['--help']).help, true);
 assert.equal(parseArgs(['--file', '/tmp/x.json']).file, '/tmp/x.json');
 assert.throws(() => parseArgs(['--format', 'yaml']), /unknown format/);
 assert.throws(() => parseArgs(['--format']), /missing value/);
 assert.throws(() => parseArgs(['nope']), /unknown option/);
});

test('the YN0 state module touches nothing the scanner owns', async () => {
 const scannerBefore = await readFile(path.join(repoRoot, 'internal/distribution-scanner/lib/scanner.mjs'), 'utf8');
 await loadStore();
 renderText(store);
 assert.equal(await readFile(path.join(repoRoot, 'internal/distribution-scanner/lib/scanner.mjs'), 'utf8'), scannerBefore);
});

test('deriveNextAction names the rule that fired', () => {
 assert.equal(deriveNextAction(byId['muraoka-collet']).rule, 'finished-no-follow-up');
 assert.equal(deriveNextAction(byId['atlos-open-endfield-map']).rule, 'waiting');
 assert.equal(deriveNextAction(byId['oyasumivr']).rule, 'observe');
 assert.equal(deriveNextAction(seed()).rule, 'not-contacted');
 assert.equal(deriveNextAction(seed()).next_action, 'REVIEW');
});
