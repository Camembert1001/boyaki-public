// Loading and rendering the YN0 contact store.
//
// The store is the SSOT: internal/yn0/contacts.json. Reading it is read-only and
// deterministic - no timestamps, no ordering by clock, no network. Two runs over the
// same file produce byte-identical output.
//
// It holds YN0 validation contacts only. BOYAKI has its own state elsewhere and the
// loader refuses anything that is not marked `program: "YN0"`.

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateStore, PROGRAM, SCHEMA, VALIDATION_DIMENSIONS} from './model.mjs';
import {derive, summarize} from './derive.mjs';

export const STORE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'contacts.json');

// Parses and validates a store object. Throws with every problem listed at once.
export function parseStore(raw) {
 const problems = validateStore(raw);
 if (problems.length) throw new Error('invalid YN0 contact store:\n - ' + problems.join('\n - '));
 return raw;
}

export async function loadStore(file = STORE_PATH) {
 return parseStore(JSON.parse(await readFile(file, 'utf8')));
}

// Stored record + derived view, for every contact, plus the programme roll-up.
export function report(store) {
 return {
  schema: SCHEMA,
  program: PROGRAM,
  summary: summarize(store.contacts),
  contacts: store.contacts.map(contact => ({...contact, derived: derive(contact)}))
 };
}

const pad = (value, width) => String(value).padEnd(width);

export function renderText(store) {
 const lines = [];
 const summary = summarize(store.contacts);
 lines.push('YN0 validation state - ' + summary.contacts + ' contacts');
 lines.push(
  'human replies ' + summary.human_replies +
  ' - problem POSITIVE ' + summary.problem_validated +
  ' - usefulness POSITIVE ' + summary.usefulness_validated +
  ' - payer validated ' + summary.payer_validated + '/' + summary.payer_countable +
  ' countable'
 );
 lines.push('waiting ' + summary.waiting + ' - needs attention ' + summary.needs_attention);
 lines.push('');
 for (const contact of store.contacts) {
  const d = derive(contact);
  const c = contact.conversation;
  lines.push('[' + d.next_action + '] ' + contact.name + ' - ' + contact.organization + ' (' + contact.id + ')');
  lines.push('  conversation: ' + c.conversation_status +
   ' - outreach ' + c.outreach_status +
   ' - human_reply ' + c.human_reply +
   ' - waiting ' + c.waiting_for_reply +
   ' - follow_up ' + c.follow_up_allowed +
   ' - reopen ' + c.reopen_condition);
  lines.push('  validation:   ' + VALIDATION_DIMENSIONS
   .map(dimension => dimension + ' ' + contact.validation[dimension].status +
    ' (' + contact.validation[dimension].evidence.length + ')')
   .join(' - '));
  lines.push('  derived:      ' + [
   'needs_attention ' + d.needs_attention,
   'can_follow_up ' + d.can_follow_up,
   'is_waiting ' + d.is_waiting,
   'is_validated ' + d.is_validated,
   'is_payer_validated ' + d.is_payer_validated,
   'can_reopen ' + d.can_reopen
  ].join(' - '));
  lines.push('  why:          ' + d.next_action_rule + ' - ' + d.next_action_reason);
 }
 lines.push('');
 lines.push('next_action counts');
 for (const [action, count] of Object.entries(summary.by_next_action)) {
  lines.push('  ' + pad(action, 16) + count);
 }
 return lines.join('\n') + '\n';
}
