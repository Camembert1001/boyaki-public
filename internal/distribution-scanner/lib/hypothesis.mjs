// The current validation hypothesis, as an input to prospect discovery.
//
// v2 asks "is this repository any good?". That is not the question that decides where a
// human's attention goes. The question that decides it is:
//
//   "Given what we already have evidence for, what would an answer from *this* candidate
//    actually teach us?"
//
// A repository can be an excellent candidate and still be worth nothing this week, because
// the axis it could speak to is already evidenced. So the axes and their current state are
// an *input*, never a constant in a source file.
//
// There is no second source of truth here. The axes are contact-state's own
// `VALIDATION_AXES`, and the default hypothesis is *derived* from a contact store rather
// than typed in: an axis is SETTLED when some contact's record carries a POSITIVE with
// evidence, which is the same bar contact-state itself enforces. An explicit hypothesis
// file can override that, and says so in the report when it does.
//
// Nothing here reads a clock, a network or an environment variable.
import {VALIDATION_AXES} from '../../contact-state/lib/model.mjs';
import {derive} from '../../contact-state/lib/derive.mjs';

export const SCHEMA = 'yn0-validation-hypothesis-v1';

// What we have on an axis, not what we believe about anyone.
//
//   OPEN     nothing anyone said settles this; an answer here is new information
//   PARTIAL  somebody answered, and the answer was NEGATIVE or AMBIGUOUS - the axis is
//            informed but not decided
//   SETTLED  a POSITIVE with cited evidence exists; asking again buys repetition
export const AXIS_STATES = ['OPEN', 'PARTIAL', 'SETTLED'];

const STATE_RANK = Object.fromEntries(AXIS_STATES.map((state, index) => [state, index]));

// How deep in the funnel each axis sits. Between two equally open axes the deeper one
// decides more, so it is asked first. This is an ordering over the axes contact-state
// already defines - not a claim that any particular axis matters most today.
const DEPTH = Object.fromEntries(VALIDATION_AXES.map((axis, index) => [axis, index]));

export class HypothesisError extends Error {}

const fail = message => {
 throw new HypothesisError(message);
};

const emptyAxis = () => ({state: 'OPEN', outstanding: false, evidence: [], source: 'default'});

// Priority: least-settled first, deeper axis first among equals, axis name last so the
// order is total and stable.
const byPriority = (a, b) =>
 STATE_RANK[a.state] - STATE_RANK[b.state] ||
 DEPTH[b.axis] - DEPTH[a.axis] ||
 (a.axis < b.axis ? -1 : 1);

function finish(axes, source) {
 const list = VALIDATION_AXES.map(axis => ({axis, ...axes[axis]})).sort(byPriority);
 const open = list.filter(entry => entry.state !== 'SETTLED');
 return {
  schema: SCHEMA,
  source,
  axes: Object.fromEntries(list.map(({axis, ...rest}) => [axis, rest])),
  // Priority order, most informative first. `focusAxis` is only a default: the caller
  // may name a different axis, and a null focus means every axis is already evidenced.
  priority: list.map(entry => entry.axis),
  openAxes: open.map(entry => entry.axis),
  focusAxis: open.length ? open[0].axis : null,
  // Axes with an answer genuinely outstanding on the wire. Filled by `withOutstanding`.
  outstandingAxes: list.filter(entry => entry.outstanding).map(entry => entry.axis).sort()
 };
}

// The least presumptuous hypothesis: nothing is settled, because nothing was consulted.
export const defaultHypothesis = () =>
 finish(Object.fromEntries(VALIDATION_AXES.map(axis => [axis, emptyAxis()])), 'default (nothing consulted)');

// Derive the hypothesis from a contact store.
//
// The rule is contact-state's own bar, not a looser one: only a POSITIVE settles an axis,
// and contact-state refuses to record a non-UNKNOWN status without cited evidence, so a
// SETTLED axis here is always backed by something a person actually said.
export function fromContactStore(store) {
 const axes = Object.fromEntries(VALIDATION_AXES.map(axis => [axis, emptyAxis()]));
 for (const {contact} of store.contacts) {
  const waiting = derive(contact).is_waiting ? contact.conversation.waiting_for_axis : null;
  if (waiting) axes[waiting].outstanding = true;
  for (const axis of VALIDATION_AXES) {
   const {status} = contact.validation[axis];
   if (status === 'UNKNOWN') continue;
   const state = status === 'POSITIVE' ? 'SETTLED' : 'PARTIAL';
   if (STATE_RANK[state] > STATE_RANK[axes[axis].state]) axes[axis].state = state;
   // The contact id, never the quote: evidence text stays inside contact-state.
   axes[axis].evidence.push(contact.id + ': ' + status);
   axes[axis].source = 'contact-state';
  }
 }
 for (const axis of VALIDATION_AXES) axes[axis].evidence.sort();
 return finish(axes, 'derived from the contact store');
}

// An explicit hypothesis file. Use it when the store is not available, or when a human
// judges an axis differently from what the store alone would say - and then the report
// shows that it came from a file rather than from evidence.
export function loadHypothesis(text, label = 'hypothesis') {
 let parsed;
 try {
  parsed = JSON.parse(text);
 } catch (error) {
  fail(label + ' is not valid JSON: ' + error.message);
 }
 if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(label + ' must be a JSON object');
 if (parsed.schema !== undefined && parsed.schema !== SCHEMA) {
  fail(label + ' has schema ' + JSON.stringify(parsed.schema) + ', expected ' + SCHEMA);
 }
 const raw = parsed.axes;
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' must carry an "axes" object');
 for (const axis of Object.keys(raw)) {
  if (!VALIDATION_AXES.includes(axis)) fail(label + ' has unknown validation axis ' + JSON.stringify(axis) + '; known axes are ' + VALIDATION_AXES.join(', '));
 }
 const axes = Object.fromEntries(VALIDATION_AXES.map(axis => {
  const entry = raw[axis];
  if (entry === undefined) return [axis, emptyAxis()];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(label + '.axes.' + axis + ' must be an object');
  const state = entry.state ?? 'OPEN';
  if (!AXIS_STATES.includes(state)) fail(label + '.axes.' + axis + '.state must be one of ' + AXIS_STATES.join(', '));
  if (entry.evidence !== undefined && !Array.isArray(entry.evidence)) fail(label + '.axes.' + axis + '.evidence must be an array');
  // A file may assert that an axis is settled; it may not assert that an answer is
  // outstanding on the wire. Only the contact store knows that, and `withOutstanding`
  // is the only way it gets in.
  return [axis, {
   state,
   outstanding: false,
   evidence: (entry.evidence ?? []).map(String),
   source: 'hypothesis file'
  }];
 }));
 return finish(axes, label);
}

// Fold the store's outstanding-answer axes into a hypothesis that came from elsewhere.
// Kept separate from `state` on purpose: "we already know this" and "somebody owes us an
// answer about this" are different facts and gate different things.
export function withOutstanding(hypothesis, outstanding) {
 const wanted = new Set(outstanding);
 const axes = Object.fromEntries(VALIDATION_AXES.map(axis => [axis, {
  ...hypothesis.axes[axis],
  outstanding: hypothesis.axes[axis].outstanding || wanted.has(axis)
 }]));
 return finish(axes, hypothesis.source);
}

// Resolve the axis this round is asking about. An explicit request wins; otherwise the
// highest-priority axis that is not already settled.
export function focusOf(hypothesis, asking) {
 if (asking) return asking;
 return hypothesis.focusAxis;
}
