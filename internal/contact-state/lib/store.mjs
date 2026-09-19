// Reading and reporting a contact store.
//
// A store is one JSON file. Each contact is either an event log (preferred: the log
// is what actually happened, the state is the fold) or an already-resolved state
// record (for importing what is known without a reconstructable history). Carrying
// both would be two sources of truth for the same contact, so it is rejected.
import {ContactStateError, SCHEMA, identityKeys, normalizeContact} from './model.mjs';
import {replay} from './transitions.mjs';
import {NEXT_ACTIONS, derive} from './derive.mjs';

const IDENTITY_KEYS = ['id', 'name', 'organization', 'channel', 'channel_ref', 'identity'];

function fail(message) {
 throw new ContactStateError(message);
}

export function resolveContact(raw) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('contact must be an object');
 const hasEvents = Array.isArray(raw.events);
 const hasState = raw.conversation !== undefined || raw.validation !== undefined;
 if (hasEvents && hasState) {
  fail('contact ' + raw.id + ' carries both events and stored state; keep one source of truth');
 }
 if (hasEvents) {
  const identity = Object.fromEntries(IDENTITY_KEYS.filter(key => key in raw).map(key => [key, raw[key]]));
  return {contact: replay(identity, raw.events), source: 'events', events: raw.events.length};
 }
 return {contact: normalizeContact(raw), source: 'state', events: 0};
}

export function loadStore(text, label = 'store') {
 let parsed;
 try {
  parsed = JSON.parse(text);
 } catch (error) {
  fail(label + ' is not valid JSON: ' + error.message);
 }
 if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(label + ' must be a JSON object');
 if (parsed.schema !== undefined && parsed.schema !== SCHEMA) fail(label + ' has schema ' + JSON.stringify(parsed.schema) + ', expected ' + SCHEMA);
 if (!Array.isArray(parsed.contacts)) fail(label + ' must carry a "contacts" array');
 const contacts = [];
 const seen = new Set();
 for (const [index, raw] of parsed.contacts.entries()) {
  let resolved;
  try {
   resolved = resolveContact(raw);
  } catch (error) {
   if (error instanceof ContactStateError) fail(label + ' contacts[' + index + ']: ' + error.message);
   throw error;
  }
  if (seen.has(resolved.contact.id)) fail(label + ' repeats contact id ' + resolved.contact.id);
  seen.add(resolved.contact.id);
  contacts.push(resolved);
 }
 return {schema: SCHEMA, contacts};
}

// How much of this store can be recognized in public.
//
// A contact with no identity evidence is *opaque*: nothing that reads this store can tell
// whether a discovered stranger is that contact or not. One opaque contact is therefore
// enough to make "we have never written to this party" unprovable by machine for every
// party, which is why the number is reported rather than buried - it is the one figure
// that says whether automatic contact checking can conclude anything at all.
export function identityCoverage(store) {
 const opaque = [];
 const indexed = [];
 for (const {contact} of store.contacts) {
  (identityKeys(contact).length === 0 ? opaque : indexed).push(contact.id);
 }
 return {
  contactCount: store.contacts.length,
  indexedCount: indexed.length,
  opaqueCount: opaque.length,
  opaqueIds: opaque.sort(),
  complete: opaque.length === 0 && store.contacts.length > 0
 };
}

export function buildReport(store) {
 const contacts = store.contacts.map(({contact, source, events}) => ({
  ...contact,
  source,
  event_count: events,
  derived: derive(contact)
 }));
 const summary = Object.fromEntries(NEXT_ACTIONS.map(action => [action, 0]));
 for (const contact of contacts) summary[contact.derived.next_action]++;
 return {
  schema: SCHEMA,
  contactCount: contacts.length,
  summary,
  needsAttention: contacts.filter(contact => contact.derived.needs_attention).map(contact => contact.id),
  contacts
 };
}

const flags = contact => {
 const c = contact.conversation;
 return [
  'waiting_for_reply=' + c.waiting_for_reply,
  'waiting_for=' + c.waiting_for + (c.waiting_for_axis === null ? '' : '/' + c.waiting_for_axis),
  'follow_up_allowed=' + c.follow_up_allowed,
  'reopen=' + c.reopen_condition
 ].join(' - ');
};

export function renderText(report, label) {
 const lines = [];
 lines.push('YN0 Contact State - ' + label);
 lines.push(report.contactCount + ' contact' + (report.contactCount === 1 ? '' : 's') + ' - ' +
  NEXT_ACTIONS.filter(action => report.summary[action] > 0).map(action => action + ' ' + report.summary[action]).join(' - '));
 lines.push('');
 for (const contact of report.contacts) {
  const c = contact.conversation;
  const d = contact.derived;
  lines.push('[' + d.next_action + '] ' + contact.id + (contact.name ? ' (' + contact.name + ')' : '') +
   (contact.organization ? ' - ' + contact.organization : ''));
  lines.push('  conversation: ' + c.conversation_status + ' - outreach ' + c.outreach_status +
   ' - human_reply ' + c.human_reply + ' - in ' + (c.last_inbound_at ?? '-') + ' - out ' + (c.last_outbound_at ?? '-') +
   (c.last_auto_inbound_at === null ? '' : ' - auto-ack ' + c.last_auto_inbound_at));
  lines.push('  flags: ' + flags(contact));
  lines.push('  validation: ' + ['problem', 'usefulness', 'workflow', 'payer']
   .map(axis => axis + ' ' + contact.validation[axis].status + '(' + contact.validation[axis].evidence.length + ')').join(' - '));
  lines.push('  derived: waiting ' + d.is_waiting + ' - can_follow_up ' + d.can_follow_up +
   ' - validated ' + d.is_validated + ' - payer_validated ' + d.is_payer_validated + ' - needs_attention ' + d.needs_attention);
  lines.push('  reason: ' + d.next_action_reason);
  for (const problem of d.inconsistencies) lines.push('  ! ' + problem);
  lines.push('');
 }
 return lines.join('\n').trimEnd() + '\n';
}
