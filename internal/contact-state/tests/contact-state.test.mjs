// Tests for the YN0 contact state machine. Run with:
//   node --test internal/contact-state/tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ContactStateError, createContact} from '../lib/model.mjs';
import {applyEvent, canSend, replay} from '../lib/transitions.mjs';
import {NEXT_ACTIONS, checkConsistency, derive} from '../lib/derive.mjs';
import {buildReport, loadStore, renderText} from '../lib/store.mjs';
import {filterReport, parseArgs} from '../state.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureFile = path.join(here, '..', 'fixtures', 'contacts.json');

const loadFixtures = async () => buildReport(loadStore(await readFile(fixtureFile, 'utf8'), 'fixtures'));
const byId = report => Object.fromEntries(report.contacts.map(contact => [contact.id, contact]));

const identity = {id: 'unit', name: 'Unit', channel: 'GMAIL'};
const evidence = summary => [{source: 'gmail', message_id: 'unit-1', quote_or_summary: summary}];

// The seven scenarios the model exists to tell apart.
test('every fixture lands in its intended conversation and validation state', async () => {
 const contacts = byId(await loadFixtures());
 const expected = {
  // 1. outreach sent, no human reply yet -> a reply really is outstanding.
  'no-reply-yet': {
   status: 'AWAITING_REPLY', waiting_for: 'FIRST_REPLY', waiting: true, follow_up: true,
   reopen: 'NOT_APPLICABLE', payer: 'UNKNOWN', usefulness: 'UNKNOWN', next: 'WAIT'
  },
  // 2. useful yes, payer not answered yet -> validated on usefulness, payer still UNKNOWN.
  'useful-payer-unknown': {
   status: 'VALIDATING', waiting_for: 'PAYER_ANSWER', waiting: true, follow_up: true,
   reopen: 'NOT_APPLICABLE', payer: 'UNKNOWN', usefulness: 'POSITIVE', next: 'WAIT'
  },
  // 3. "would buy at $5" -> payer POSITIVE, and they are owed an answer.
  'payer-positive': {
   status: 'REPLIED', waiting_for: 'NOTHING', waiting: false, follow_up: true,
   reopen: 'NOT_APPLICABLE', payer: 'POSITIVE', usefulness: 'POSITIVE', next: 'RESPOND'
  },
  // 4. clearly not needed -> NEGATIVE on the axes they actually answered.
  'clearly-not-needed': {
   status: 'REPLIED', waiting_for: 'NOTHING', waiting: false, follow_up: false,
   reopen: 'NOT_APPLICABLE', payer: 'UNKNOWN', usefulness: 'NEGATIVE', next: 'CLOSE'
  },
  // 5. Muraoka: payer UNKNOWN, but nothing is outstanding and nothing may be sent.
  muraoka: {
   status: 'STALLED', waiting_for: 'NOTHING', waiting: false, follow_up: false,
   reopen: 'INBOUND_ONLY', payer: 'UNKNOWN', usefulness: 'UNKNOWN', next: 'CLOSE'
  },
  // 6. Banzai: thanked us and ended the thread.
  banzai: {
   status: 'CLOSED', waiting_for: 'NOTHING', waiting: false, follow_up: false,
   reopen: 'INBOUND_ONLY', payer: 'UNKNOWN', usefulness: 'AMBIGUOUS', next: 'DO_NOT_CONTACT'
  },
  // 7. Atlos: closed, then wrote to us -> reopened.
  atlos: {
   status: 'REPLIED', waiting_for: 'NOTHING', waiting: false, follow_up: true,
   reopen: 'NOT_APPLICABLE', payer: 'UNKNOWN', usefulness: 'UNKNOWN', next: 'RESPOND'
  }
 };
 assert.deepEqual(Object.keys(contacts).sort(), Object.keys(expected).sort());
 for (const [id, want] of Object.entries(expected)) {
  const {conversation, validation, derived} = contacts[id];
  assert.equal(conversation.conversation_status, want.status, id + '.conversation_status');
  assert.equal(conversation.waiting_for, want.waiting_for, id + '.waiting_for');
  assert.equal(conversation.waiting_for_reply, want.waiting, id + '.waiting_for_reply');
  assert.equal(conversation.follow_up_allowed, want.follow_up, id + '.follow_up_allowed');
  assert.equal(conversation.reopen_condition, want.reopen, id + '.reopen_condition');
  assert.equal(validation.payer.status, want.payer, id + '.payer');
  assert.equal(validation.usefulness.status, want.usefulness, id + '.usefulness');
  assert.equal(derived.next_action, want.next, id + '.next_action');
  assert.equal(derived.is_waiting, want.waiting, id + '.is_waiting');
  assert.deepEqual(derived.inconsistencies, [], id + ' must not contradict itself');
  assert.ok(NEXT_ACTIONS.includes(derived.next_action));
 }
});

// The bug this model exists to prevent.
test('payer UNKNOWN never by itself means an answer is outstanding', async () => {
 const contacts = byId(await loadFixtures());
 const unknownPayer = Object.values(contacts).filter(contact => contact.validation.payer.status === 'UNKNOWN');
 assert.ok(unknownPayer.length >= 4);
 for (const contact of unknownPayer) {
  if (contact.derived.is_waiting) {
   // The only reason to be waiting is a question that is still open on the wire.
   assert.equal(contact.conversation.waiting_for_reply, true, contact.id);
   assert.notEqual(contact.conversation.waiting_for, 'NOTHING', contact.id);
   assert.ok(['AWAITING_REPLY', 'VALIDATING'].includes(contact.conversation.conversation_status), contact.id);
  }
 }
 // Muraoka is the case that was misread: the payer question was sent, a human did
 // reply, the question was never answered, and we released them from answering.
 const muraoka = contacts.muraoka;
 assert.equal(muraoka.validation.payer.status, 'UNKNOWN');
 assert.equal(muraoka.conversation.human_reply, true);
 assert.equal(muraoka.conversation.reply_waived, true);
 assert.equal(muraoka.conversation.waiting_for_reply, false);
 assert.equal(muraoka.derived.is_waiting, false);
 assert.equal(muraoka.derived.can_follow_up, false);
 assert.equal(muraoka.derived.needs_attention, false);
 assert.ok(['STALLED', 'CLOSED'].includes(muraoka.conversation.conversation_status));
 assert.equal(muraoka.derived.next_action, 'CLOSE');
});

test('conversation state and validation state never write to each other', () => {
 const base = replay(identity, [{type: 'OUTREACH_SENT', at: '2026-09-01T09:00:00Z'}]);

 // Recording what we learned does not change what is outstanding.
 const recorded = applyEvent(base, {type: 'VALIDATION_RECORDED', axis: 'payer', status: 'POSITIVE', evidence: evidence('would buy at $5')});
 assert.deepEqual(recorded.conversation, base.conversation);
 assert.equal(recorded.validation.payer.status, 'POSITIVE');

 // Asking a question does not change what we know.
 const asked = applyEvent(recorded, {type: 'QUESTION_SENT', at: '2026-09-02T09:00:00Z', waiting_for: 'PAYER_ANSWER'});
 assert.deepEqual(asked.validation, recorded.validation);
 assert.equal(asked.conversation.waiting_for, 'PAYER_ANSWER');

 // And an inbound reply does not silently record an answer.
 const replied = applyEvent(asked, {type: 'INBOUND_REPLY', at: '2026-09-03T09:00:00Z'});
 assert.deepEqual(replied.validation, recorded.validation);
});

test('a non-UNKNOWN validation status requires evidence', () => {
 const base = replay(identity, [{type: 'OUTREACH_SENT', at: '2026-09-01T09:00:00Z'}]);
 for (const status of ['POSITIVE', 'NEGATIVE', 'AMBIGUOUS']) {
  assert.throws(
   () => applyEvent(base, {type: 'VALIDATION_RECORDED', axis: 'payer', status}),
   ContactStateError,
   status + ' without evidence must be refused');
 }
 assert.doesNotThrow(() => applyEvent(base, {type: 'VALIDATION_RECORDED', axis: 'payer', status: 'UNKNOWN'}));
 const guessed = createContact(identity);
 guessed.conversation.human_reply = true;
 guessed.conversation.last_inbound_at = '2026-09-01T09:00:00Z';
 guessed.validation.payer = {status: 'POSITIVE', evidence: []};
 assert.deepEqual(checkConsistency(guessed), ['payer=POSITIVE without evidence']);
 assert.equal(derive(guessed).next_action, 'REVIEW');
});

test('the main transition path moves through the documented statuses', () => {
 const steps = [
  [{type: 'OUTREACH_SENT', at: '2026-09-01T09:00:00Z'}, 'AWAITING_REPLY', true],
  [{type: 'INBOUND_REPLY', at: '2026-09-02T09:00:00Z'}, 'REPLIED', false],
  [{type: 'QUESTION_SENT', at: '2026-09-03T09:00:00Z', waiting_for: 'VALIDATION_ANSWER'}, 'VALIDATING', true],
  [{type: 'FOLLOW_UP_SENT', at: '2026-09-10T09:00:00Z'}, 'VALIDATING', true],
  [{type: 'NO_REPLY_TIMEOUT', at: '2026-09-17T09:00:00Z'}, 'STALLED', false],
  [{type: 'CONVERSATION_ENDED', at: '2026-09-20T09:00:00Z', direction: 'outbound', reason: 'shelved'}, 'CLOSED', false]
 ];
 let contact = createContact(identity);
 assert.equal(contact.conversation.conversation_status, 'DISCOVERED');
 assert.equal(derive(contact).next_action, 'REVIEW', 'first contact is a human decision');
 for (const [event, status, waiting] of steps) {
  contact = applyEvent(contact, event);
  assert.equal(contact.conversation.conversation_status, status, event.type);
  assert.equal(contact.conversation.waiting_for_reply, waiting, event.type + '.waiting_for_reply');
  assert.deepEqual(derive(contact).inconsistencies, [], event.type);
 }
 // A stalled thread nobody was released from is a legitimate follow-up.
 const stalled = replay(identity, steps.slice(0, 5).map(([event]) => event));
 assert.equal(stalled.conversation.follow_up_allowed, true);
 assert.equal(derive(stalled).next_action, 'FOLLOW_UP');
});

test('waiving a reply removes the wait and the follow-up, not the payer question', () => {
 const waived = replay(identity, [
  {type: 'OUTREACH_SENT', at: '2026-09-08T09:00:00Z'},
  {type: 'INBOUND_REPLY', at: '2026-09-09T00:41:00Z'},
  {type: 'QUESTION_SENT', at: '2026-09-09T09:05:00Z', waiting_for: 'PAYER_ANSWER'},
  {type: 'REPLY_WAIVED', at: '2026-09-11T08:00:00Z'}
 ]);
 assert.equal(waived.conversation.waiting_for_reply, false);
 assert.equal(waived.conversation.waiting_for, 'NOTHING');
 assert.equal(waived.conversation.follow_up_allowed, false);
 assert.equal(waived.validation.payer.status, 'UNKNOWN');
 assert.equal(derive(waived).next_action, 'CLOSE');
 // Silence after a waiver is the outcome we asked for, so it does not re-open a follow-up.
 const stalled = applyEvent(waived, {type: 'NO_REPLY_TIMEOUT', at: '2026-09-18T09:00:00Z'});
 assert.equal(stalled.conversation.follow_up_allowed, false);
 assert.equal(stalled.conversation.reopen_condition, 'INBOUND_ONLY');
 assert.equal(derive(stalled).can_follow_up, false);
});

test('outbound events are refused when the conversation does not allow them', async () => {
 const contacts = byId(await loadFixtures());
 const cases = [
  ['banzai', 'FOLLOW_UP_SENT', /CLOSED/],
  ['banzai', 'QUESTION_SENT', /CLOSED/],
  ['muraoka', 'FOLLOW_UP_SENT', /no reply is needed/],
  ['muraoka', 'QUESTION_SENT', /no reply is needed/]
 ];
 for (const [id, type, pattern] of cases) {
  const contact = contacts[id];
  assert.equal(canSend(contact, type).ok, false, id + ' must refuse ' + type);
  assert.throws(
   () => applyEvent(contact, {type, at: '2026-09-30T09:00:00Z', waiting_for: 'PAYER_ANSWER'}),
   pattern,
   id + ' ' + type);
 }
 // An opted-out contact refuses everything outbound, including a first outreach.
 const optedOut = replay(identity, [
  {type: 'OUTREACH_SENT', at: '2026-09-01T09:00:00Z'},
  {type: 'OPT_OUT', at: '2026-09-02T09:00:00Z', reason: 'asked not to be contacted'}
 ]);
 assert.equal(derive(optedOut).next_action, 'DO_NOT_CONTACT');
 assert.equal(canSend(optedOut, 'OUTREACH_SENT').ok, false);
 assert.equal(canSend(optedOut, 'REPLY_WAIVED').ok, false);
 // ... and an inbound message from them does not reopen anything by itself.
 const wroteBack = applyEvent(optedOut, {type: 'INBOUND_REPLY', at: '2026-09-05T09:00:00Z'});
 assert.equal(wroteBack.conversation.conversation_status, 'CLOSED');
 assert.equal(wroteBack.conversation.reopen_condition, 'NEVER');
 assert.equal(wroteBack.conversation.follow_up_allowed, false);
 assert.equal(derive(wroteBack).next_action, 'REVIEW');
 assert.equal(derive(wroteBack).needs_attention, true);
});

test('an inbound message reopens a contact closed under INBOUND_ONLY', async () => {
 const contacts = byId(await loadFixtures());
 const closed = replay(identity, [
  {type: 'OUTREACH_SENT', at: '2026-09-01T09:00:00Z'},
  {type: 'NO_REPLY_TIMEOUT', at: '2026-09-10T09:00:00Z'},
  {type: 'CONVERSATION_ENDED', at: '2026-09-12T09:00:00Z', direction: 'outbound', reason: 'no response; shelved'}
 ]);
 assert.equal(closed.conversation.conversation_status, 'CLOSED');
 assert.equal(derive(closed).next_action, 'DO_NOT_CONTACT');
 assert.equal(derive(closed).can_follow_up, false);

 const reopened = applyEvent(closed, {type: 'INBOUND_REPLY', at: '2026-09-17T23:40:00Z'});
 assert.equal(reopened.conversation.conversation_status, 'REPLIED');
 assert.equal(reopened.conversation.human_reply, true);
 assert.equal(reopened.conversation.reopen_condition, 'NOT_APPLICABLE');
 assert.equal(reopened.conversation.closed_reason, null);
 assert.equal(reopened.conversation.follow_up_allowed, true);
 assert.equal(derive(reopened).next_action, 'RESPOND');
 assert.deepEqual(reopened.conversation, contacts.atlos.conversation);
});

test('a contradictory stored record routes to REVIEW instead of to an action', () => {
 const contact = createContact(identity);
 contact.conversation = {
  ...contact.conversation,
  outreach_status: 'SENT',
  last_outbound_at: '2026-09-01T09:00:00Z',
  human_reply: true,
  last_inbound_at: '2026-09-02T09:00:00Z',
  conversation_status: 'CLOSED',
  waiting_for: 'PAYER_ANSWER',
  waiting_for_reply: true,
  follow_up_allowed: true,
  reopen_condition: 'INBOUND_ONLY'
 };
 const problems = checkConsistency(contact);
 assert.deepEqual(problems, [
  'waiting_for_reply=true while conversation_status=CLOSED',
  'follow_up_allowed=true on a CLOSED contact'
 ]);
 const derived = derive(contact);
 assert.equal(derived.next_action, 'REVIEW');
 assert.equal(derived.can_follow_up, false, 'a contradictory record may never be followed up');
 assert.equal(derived.needs_attention, true);
});

test('the store rejects ambiguous or duplicated records', () => {
 const store = contacts => JSON.stringify({schema: 'yn0-contact-state-v1', contacts});
 assert.throws(() => loadStore(store([{id: 'a', events: [], conversation: {}}])), /one source of truth/);
 assert.throws(() => loadStore(store([{id: 'a', events: []}, {id: 'a', events: []}])), /repeats contact id/);
 assert.throws(() => loadStore(JSON.stringify({schema: 'other', contacts: []})), /expected yn0-contact-state-v1/);
 assert.throws(() => loadStore(JSON.stringify({contacts: {}})), /"contacts" array/);
 assert.throws(() => loadStore('not json'), /not valid JSON/);
 assert.throws(() => loadStore(store([{id: 'a', channel: 'CARRIER_PIGEON'}])), /channel must be one of/);
 assert.throws(() => loadStore(store([{id: 'a', events: [{type: 'OUTREACH_SENT', at: 'yesterday'}]}])), /ISO 8601/);
 // Events are a log, so they may not travel backwards in time.
 assert.throws(() => loadStore(store([{
  id: 'a',
  events: [
   {type: 'OUTREACH_SENT', at: '2026-09-05T09:00:00Z'},
   {type: 'INBOUND_REPLY', at: '2026-09-01T09:00:00Z'}
  ]
 }])), /chronological order/);
 // A record with no events at all is simply a discovered contact.
 const minimal = loadStore(store([{id: 'a'}]));
 assert.equal(minimal.contacts[0].contact.conversation.conversation_status, 'DISCOVERED');
 assert.equal(minimal.contacts[0].source, 'state');
});

test('the report is deterministic and carries no clock', async () => {
 const text = await readFile(fixtureFile, 'utf8');
 const first = JSON.stringify(buildReport(loadStore(text)), null, 2);
 const second = JSON.stringify(buildReport(loadStore(text)), null, 2);
 assert.equal(first, second);
 assert.equal(first.includes('generated_at'), false);
 assert.equal(first.includes('2026-09-19'), false, 'no timestamp may come from the clock');
 assert.ok(renderText(buildReport(loadStore(text)), 'fixtures').startsWith('YN0 Contact State - fixtures'));
});

test('the CLI parses its arguments and filters without re-deriving', async () => {
 assert.deepEqual(parseArgs(['--help']), {help: true});
 assert.throws(() => parseArgs([]), /path is required/);
 assert.throws(() => parseArgs(['a.json', '--format', 'yaml']), /unknown format/);
 assert.throws(() => parseArgs(['a.json', '--action', 'SELL']), /unknown action/);
 assert.throws(() => parseArgs(['a.json', 'b.json']), /only one store/);
 assert.throws(() => parseArgs(['a.json', '--id']), /missing value/);
 const parsed = parseArgs(['a.json', '--action', 'WAIT', '--attention', '--strict']);
 assert.equal(parsed.target, 'a.json');
 assert.deepEqual(parsed.options, {format: 'text', out: null, id: null, action: 'WAIT', attention: true, strict: true});

 const report = await loadFixtures();
 const waiting = filterReport(report, {...parsed.options, attention: false});
 assert.deepEqual(waiting.contacts.map(contact => contact.id), ['no-reply-yet', 'useful-payer-unknown']);
 assert.equal(waiting.summary.WAIT, 2);
 const attention = filterReport(report, {format: 'text', out: null, id: null, action: null, attention: true, strict: false});
 assert.deepEqual(attention.contacts.map(contact => contact.id), ['payer-positive', 'atlos']);
 const one = filterReport(report, {format: 'text', out: null, id: 'muraoka', action: null, attention: false, strict: false});
 assert.equal(one.contactCount, 1);
});
