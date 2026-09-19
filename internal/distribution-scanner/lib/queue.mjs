// The candidate queue: where a human actually reads the output.
//
// v2's three verdicts are unchanged and stay unchanged. `candidates.mjs` still answers
// "is this repository worth a person's attention?" with READY_FOR_REVIEW / HUMAN_REVIEW /
// IGNORE, and v3 does not add a fourth verdict to it, re-rank its rules or widen
// READY_FOR_REVIEW by a single case. This is a layer above: it takes v2's verdict as a
// fact and sorts candidates into the lanes a person works through.
//
//   READY_FOR_REVIEW  v2 proposed it, the question we are asking is open, and this
//                     candidate's published work bears on that question.
//   HUMAN_REVIEW      something here is a human's to decide, including "we have no public
//                     evidence either way", which is a decision and not a rejection.
//   RESERVE           a good candidate, held. Not dropped, not queued: the reason it is
//                     held is recorded, and so is what would release it.
//   IGNORE            v2 dropped it, with a rule number.
//
// RESERVE is the lane this layer exists for. The Prospect Burn rule says that while one
// contact owes us an answer on an axis, a second stranger asked the same question buys
// nothing - but the *candidate* is still good, and throwing it away means finding it
// again later. So exploration continues, evaluation continues, candidates accumulate, and
// the gate in front of contact stays shut. No lane is an instruction to contact anyone;
// the most positive of them means "read this next".
import {VALUE_RANK} from './value.mjs';

export const LANES = ['READY_FOR_REVIEW', 'HUMAN_REVIEW', 'RESERVE', 'IGNORE'];

const LANE_RANK = Object.fromEntries(LANES.map((lane, index) => [lane, index]));

// v2's rule 16 - "the same validation question is already outstanding elsewhere". v2 can
// only say HUMAN_REVIEW there; this layer has a lane that says it properly.
const OUTSTANDING_RULE = 16;

// Ordered. First match wins, and the lane always comes with the rule that produced it.
//
//  #  condition                                                        lane
//  1  v2 dropped it                                                    IGNORE
//  2  contact history is not "consulted, and nothing there"            HUMAN_REVIEW
//  3  v2 held it because this exact question is outstanding elsewhere  RESERVE
//  4  v2 held it for a human for any other reason                      HUMAN_REVIEW
//  5  the candidate may be the same party as another candidate         HUMAN_REVIEW
//  6  the axis this round asks about is outstanding elsewhere          RESERVE
//  7  a better-evidenced candidate is definitely the same party        RESERVE
//  8  no validation axis is open at all                                RESERVE
//  9  no public evidence bears on the axis we are asking about         HUMAN_REVIEW
// 10  the public evidence argues against asking this one               RESERVE
// 11  otherwise                                                        READY_FOR_REVIEW
export function decideLane(facts) {
 const {prospect, value, identity, focus, outstandingAxes, duplicateOf} = facts;
 const lane = (number, name, reason, release = null) => ({lane: number, name, reason, release});

 if (prospect.verdict === 'IGNORE') {
  return lane(1, 'IGNORE', 'v2 rule ' + prospect.rule + ': ' + prospect.reason);
 }
 if (prospect.contact.posture !== 'NEVER_CONTACTED') {
  return lane(2, 'HUMAN_REVIEW', 'contact-state posture is ' + prospect.contact.posture + ' - ' + prospect.contact.reason,
   'check this candidate against the contact store and record the result');
 }
 if (prospect.verdict === 'HUMAN_REVIEW' && prospect.rule === OUTSTANDING_RULE) {
  return lane(3, 'RESERVE', 'v2 rule ' + prospect.rule + ': ' + prospect.reason,
   'an answer arrives on the ' + focus + ' axis, or this round asks about a different axis');
 }
 if (prospect.verdict === 'HUMAN_REVIEW') {
  return lane(4, 'HUMAN_REVIEW', 'v2 rule ' + prospect.rule + ': ' + prospect.reason);
 }
 if (identity.state === 'AMBIGUOUS') {
  return lane(5, 'HUMAN_REVIEW', 'identity is ambiguous: ' + identity.reason,
   'a human confirms whether these are the same party');
 }
 if (focus && outstandingAxes.includes(focus)) {
  return lane(6, 'RESERVE', 'an answer on the ' + focus + ' axis is already outstanding from another contact; ' +
   'a second one buys no information we are not already about to get',
   'that answer arrives, or this round asks about a different axis');
 }
 if (duplicateOf) {
  return lane(7, 'RESERVE', 'the same declared owner as ' + duplicateOf + ', which carries the stronger evidence; ' +
   'two candidates from one party are one contact',
   duplicateOf + ' is read and resolved');
 }
 if (!focus) {
  return lane(8, 'RESERVE', 'no validation axis is open: every axis already carries cited evidence, ' +
   'so there is no question this candidate could answer that we do not have',
   'a new axis opens, or an existing answer is reopened');
 }
 if (value.value === 'UNKNOWN') {
  return lane(9, 'HUMAN_REVIEW', 'value rule ' + value.rule + ': ' + value.reason,
   'someone cites public evidence for or against this candidate on the ' + focus + ' axis');
 }
 if (value.value === 'LOW') {
  return lane(10, 'RESERVE', 'value rule ' + value.rule + ': ' + value.reason,
   'public evidence appears that bears on the ' + focus + ' axis, or the open axis changes');
 }
 return lane(11, 'READY_FOR_REVIEW', value.value + ' information value on the open ' + focus + ' axis - ' + value.reason);
}

// Ranking inside a lane, and between candidates of the same party.
//
// Value first, because the whole point is information per contact; then the weight of the
// mechanical evidence, because that is what a first message would actually cite; then the
// id, so the order is total and the report is reproducible.
export const rankOf = entry => [
 VALUE_RANK[entry.value.value],
 -entry.prospect.evidence.highConfidenceFindings,
 entry.id
];

export function compareCandidates(a, b) {
 const left = rankOf(a);
 const right = rankOf(b);
 for (let i = 0; i < left.length; i++) {
  if (left[i] < right[i]) return -1;
  if (left[i] > right[i]) return 1;
 }
 return 0;
}

export const compareByLane = (a, b) =>
 LANE_RANK[a.queue.name] - LANE_RANK[b.queue.name] || compareCandidates(a, b);
