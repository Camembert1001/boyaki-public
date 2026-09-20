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
// RESERVE is the lane this layer exists for. A candidate can be good and still not be the
// one to read next - it duplicates a party already in the queue, no axis is open, the
// public evidence argues against it - and throwing it away means finding it again later.
// So exploration continues, evaluation continues, candidates accumulate, and the gate in
// front of contact stays shut. No lane is an instruction to contact anyone; the most
// positive of them means "read this next".
//
// What RESERVE is *not* is a global hold. An answer outstanding from one party holds that
// party (lane 6, scoped to its own contacts); it does not hold a different party that the
// contact store was asked about on its own identifiers and did not recognize. Those are
// independent samples of the same hypothesis, and independence is the thing that makes
// them worth anything.
import {VALUE_RANK} from './value.mjs';

export const LANES = ['READY_FOR_REVIEW', 'HUMAN_REVIEW', 'RESERVE', 'IGNORE'];

const LANE_RANK = Object.fromEntries(LANES.map((lane, index) => [lane, index]));

// v2's rule 16 - "this party already owes us the answer we would be asking for". v2 can
// only say HUMAN_REVIEW there; this layer has a lane that says it properly.
const OUTSTANDING_RULE = 16;

// Ordered. First match wins, and the lane always comes with the rule that produced it.
//
//  #  condition                                                        lane
//  1  v2 dropped it                                                    IGNORE
//  2  contact history is not "consulted, and nothing there"            HUMAN_REVIEW
//  3  v2 held it because this party already owes us that same answer   RESERVE
//  4  v2 held it for a human for any other reason                      HUMAN_REVIEW
//  5  the candidate may be the same party as another candidate         HUMAN_REVIEW
//  6  this party already owes us the answer we would be asking for     RESERVE
//  7  a better-evidenced candidate is definitely the same party        RESERVE
//  8  no validation axis is open at all                                RESERVE
//  9  no public evidence bears on the axis we are asking about         HUMAN_REVIEW
// 10  the public evidence argues against asking this one               RESERVE
// 11  otherwise                                                        READY_FOR_REVIEW
export function decideLane(facts) {
 const {prospect, value, identity, focus, duplicateOf} = facts;
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
 // Scoped to this candidate's own contacts, never to the store. A different party the
 // store was searched for and did not recognize is an independent sample of the same
 // question, and holding it would be holding its information hostage to somebody else's
 // silence. A party that does owe us an answer is not NEVER_CONTACTED and has already
 // stopped at lane 1 or 2; this is the backstop behind that.
 if (focus && (prospect.contact.outstandingAxes ?? []).includes(focus)) {
  return lane(6, 'RESERVE', 'this party already owes us an answer on the ' + focus + ' axis; ' +
   'asking the same contact the same question again is a duplicate',
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
