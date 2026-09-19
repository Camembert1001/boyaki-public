// Validation value: what would an answer from this candidate actually teach us?
//
// This is not a predictor and must never become one. It does not estimate whether anyone
// would buy, reply, or be worth talking to. It answers a narrower and checkable question:
//
//   given the axis we currently have no evidence on, does this candidate's *published
//   work* put them in a position to say something we do not already know?
//
// The difference matters. "This party publishes a rate card for game localization and
// files locale bugs itself" is an observation about published work. "This party would pay
// for YN0" is a guess about a stranger, and nothing in this file produces one.
//
// Every verdict is an ordered rule with a number, the cited signals that fed it, and the
// list of things that stayed unknown. There is no score without a reason, and no reason
// without a citation.
import {VALIDATION_AXES} from '../../contact-state/lib/model.mjs';
import {FORBIDDEN_INFERENCES, SIGNALS, forAxis} from './signals.mjs';

export const VALUES = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

// Ranking for display and de-duplication only. UNKNOWN sits above LOW because "we have
// no public evidence either way" is a question for a human, while "the public evidence
// argues against it" is an answer.
export const VALUE_RANK = {HIGH: 0, MEDIUM: 1, UNKNOWN: 2, LOW: 3};

// Ordered. The first matching rule wins and its number is reported, so "why is this
// MEDIUM" always has a rule number as its answer.
//
//  #  condition                                                        value
//  1  the axis is already settled by evidence we have                  LOW
//  2  no cited public evidence touches this axis                       UNKNOWN
//  3  only evidence arguing against                                    LOW
//  4  a single supporting observation                                  LOW
//  5  supporting and weakening evidence both present                   MEDIUM
//  6  two or more supporting, at least one specific enough to stand    HIGH
//  7  two or more supporting, none specific on its own                 MEDIUM
export function valueForAxis(axis, signals, hypothesis) {
 if (!VALIDATION_AXES.includes(axis)) throw new Error('unknown validation axis: ' + axis);
 const {supporting, weakening} = forAxis(signals, axis);
 const state = hypothesis?.axes?.[axis]?.state ?? 'OPEN';
 const cite = list => list.map(item => item.signal + ' (' + item.source + '): ' + item.observed);
 const strong = supporting.filter(item => SIGNALS[item.signal].strength === 'STRONG');

 const verdict = (rule, value, reason) => ({
  axis,
  value,
  rule,
  reason,
  axisState: state,
  evidence: cite(supporting),
  weakening: cite(weakening),
  // Always present, always the same, never filled in. See signals.mjs.
  unknown: [...FORBIDDEN_INFERENCES]
 });

 if (state === 'SETTLED') {
  return verdict(1, 'LOW', 'the ' + axis + ' axis is already settled by cited evidence; an answer here repeats what we have');
 }
 if (supporting.length === 0 && weakening.length === 0) {
  return verdict(2, 'UNKNOWN', 'no cited public evidence bears on the ' + axis + ' axis; nothing is assumed in either direction');
 }
 if (supporting.length === 0) {
  return verdict(3, 'LOW', weakening.length + ' cited observation(s) argue against this candidate on the ' + axis + ' axis');
 }
 if (supporting.length === 1) {
  return verdict(4, 'LOW', 'one supporting observation is an anecdote, not a case');
 }
 if (weakening.length > 0) {
  return verdict(5, 'MEDIUM', supporting.length + ' supporting and ' + weakening.length +
   ' opposing observation(s); the public evidence is contested, so a human reads both');
 }
 if (strong.length > 0) {
  return verdict(6, 'HIGH', supporting.length + ' supporting observation(s), ' + strong.length +
   ' of them specific to the ' + axis + ' axis on its own');
 }
 return verdict(7, 'MEDIUM', supporting.length + ' supporting observation(s), none of which is specific on its own');
}

// Every axis, plus the one this round is actually asking about.
//
// `focus` is the axis whose value decides where the candidate lands. A candidate can be
// HIGH on an axis nobody is asking about and that is worth exactly nothing this round -
// which is the whole point of separating "good repository" from "useful right now".
export function evaluateValue(signals, hypothesis, focus) {
 const axes = Object.fromEntries(VALIDATION_AXES.map(axis => [axis, valueForAxis(axis, signals, hypothesis)]));
 const focused = focus ? axes[focus] : null;
 return {
  focusAxis: focus ?? null,
  value: focused ? focused.value : 'UNKNOWN',
  rule: focused ? focused.rule : null,
  reason: focused
   ? focused.reason
   : 'no axis is open: every validation axis already carries cited evidence, so nothing here is worth asking now',
  axes,
  signalCount: signals.length,
  unknown: [...FORBIDDEN_INFERENCES]
 };
}
