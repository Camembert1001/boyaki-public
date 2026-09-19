// Candidate evaluation for the YN0 Prospect Discovery layer.
//
// The last mechanical step before a human. It takes everything the machine can know
// about one repository - localization assets, mechanical findings with their confidence
// band, locale completeness, external metadata, contact posture - and answers one
// question with an ordered rule table:
//
//   READY_FOR_REVIEW  a person should look at this, and there is a specific,
//                     defensible finding to look at.
//   HUMAN_REVIEW      a person has to decide something the machine cannot.
//   IGNORE            drop it; here is the rule that dropped it.
//
// What this is not: it does not decide who gets contacted, and no verdict is an
// instruction to contact anyone. READY_FOR_REVIEW means "worth a human's attention",
// which is upstream of every decision about whether, how and by whom anyone is written
// to. Nothing downstream of this file sends anything, because there is nothing
// downstream of this file.
//
// The success condition is the number of candidates *dropped* before a human spends
// attention on them, not the number produced. Every rule below is written to fail
// closed: when the machine is unsure, the verdict is HUMAN_REVIEW or IGNORE, never
// READY_FOR_REVIEW.
import {bandCounts, noiseRatio} from './confidence.mjs';

export const VERDICTS = ['READY_FOR_REVIEW', 'HUMAN_REVIEW', 'IGNORE'];

export const DEFAULT_PROSPECT_THRESHOLDS = {
 minCompleteness: 0.85,   // share of EN keys with a Japanese value before the locale is worth judging
 minHighConfidence: 1,    // high-confidence findings needed before a contact is defensible
 maxNoiseRatio: 0.9       // share of citable findings that may be intentional-risk (see confidence.mjs)
};

const round = value => Math.round(value * 10000) / 10000;

// Fold every scanned EN/JA pair in one repository into a single evidence record.
export function aggregate(scanReport) {
 const findingsByRule = {};
 let enKeyCount = 0;
 let jaKeyCount = 0;
 let blankFindings = 0;
 let totalFindings = 0;
 for (const pair of scanReport.pairs) {
  enKeyCount += pair.enKeyCount;
  jaKeyCount += pair.jaKeyCount;
  blankFindings += pair.blankFindings;
  totalFindings += pair.totalFindings;
  for (const [rule, count] of Object.entries(pair.findingsByRule)) findingsByRule[rule] = (findingsByRule[rule] || 0) + count;
 }
 const bands = bandCounts(findingsByRule);
 return {
  pairCount: scanReport.pairs.length,
  skippedPairCount: scanReport.skipped.length,
  enKeyCount,
  jaKeyCount,
  untranslatedKeys: blankFindings,
  localeCompleteness: enKeyCount ? round(1 - blankFindings / enKeyCount) : 0,
  totalFindings,
  highConfidenceFindings: bands.HIGH_CONFIDENCE,
  intentionalRiskFindings: bands.INTENTIONAL_RISK,
  incompleteLocaleFindings: bands.INCOMPLETE_LOCALE,
  noiseRatio: round(noiseRatio(bands)),
  findingsByRule: Object.fromEntries(Object.keys(findingsByRule).sort().map(rule => [rule, findingsByRule[rule]])),
  scannerClassifications: Object.fromEntries(
   [...new Set(scanReport.pairs.map(pair => pair.classification))].sort()
    .map(name => [name, scanReport.pairs.filter(pair => pair.classification === name).length])
  )
 };
}

// Ordered. The first matching rule wins and its number and text are reported, so
// "why was this dropped" always has a rule number as its answer.
//
//  #  condition                                                      verdict
//  1  contact opted out                                              IGNORE
//  2  conversation closed (reopens on inbound or not at all)          IGNORE
//  3  a thread already exists / an answer is outstanding             IGNORE
//  4  contact identity unresolved, ambiguous, or flagged by the model HUMAN_REVIEW
//  5  repository is dormant                                          IGNORE
//  6  no public contact route                                        IGNORE
//  7  no localization assets at all                                  IGNORE
//  8  assets exist but no format the checker can read                HUMAN_REVIEW
//  9  assets are readable but no EN/JA pair                          IGNORE
// 10  locale too incomplete to judge                                 IGNORE
// 11  nothing but clean strings and untranslated keys                IGNORE
// 12  findings exist but none survive "could this be on purpose?"    HUMAN_REVIEW
// 13  a defensible finding drowned in ones that are not              IGNORE
// 14  contact history never checked                                  HUMAN_REVIEW
// 15  repository activity unknown                                    HUMAN_REVIEW
// 16  the same validation question is already outstanding elsewhere  HUMAN_REVIEW
// 17  otherwise                                                      READY_FOR_REVIEW
export function decide(facts, thresholds) {
 const {contact, metadata, assets, evidence, asking, outstandingAxes} = facts;
 const rule = (number, verdict, reason) => ({rule: number, verdict, reason});

 if (contact.posture === 'DO_NOT_CONTACT') return rule(1, 'IGNORE', 'contact-state: ' + contact.reason);
 if (contact.posture === 'CLOSED' || contact.posture === 'INBOUND_ONLY') return rule(2, 'IGNORE', 'contact-state: ' + contact.reason);
 if (contact.posture === 'ALREADY_CONTACTED' || contact.posture === 'AWAITING_REPLY') {
  return rule(3, 'IGNORE', 'contact-state: ' + contact.reason);
 }
 if (contact.posture === 'NEEDS_HUMAN' || contact.posture === 'UNRESOLVED' || contact.posture === 'AMBIGUOUS_MATCH') {
  return rule(4, 'HUMAN_REVIEW', 'contact identity is not settled - ' + contact.reason);
 }

 if (metadata.activity === 'DORMANT') {
  return rule(5, 'IGNORE', 'repository is recorded as dormant' + (metadata.activity_evidence ? ' (' + metadata.activity_evidence + ')' : ''));
 }
 if (metadata.public_contact_route === 'NONE') {
  return rule(6, 'IGNORE', 'no public contact route is recorded, so there is nothing a human could act on');
 }

 if (assets.assetCount === 0) return rule(7, 'IGNORE', 'no localization assets of any known format were found');
 if (evidence.pairCount === 0) {
  if (assets.unsupportedFormats.length) {
   return rule(8, 'HUMAN_REVIEW', 'localization exists in a format the checker cannot read: ' +
    assets.unsupportedFormats.join(', ') + ' (DETECTED_BUT_UNSUPPORTED)');
  }
  return rule(9, 'IGNORE', 'localization assets exist but form no EN/JA pair the checker can compare');
 }

 if (evidence.localeCompleteness < thresholds.minCompleteness) {
  return rule(10, 'IGNORE', evidence.untranslatedKeys + ' of ' + evidence.enKeyCount + ' EN keys have no Japanese value; ' +
   'the locale is ' + (evidence.localeCompleteness * 100).toFixed(1) + '% complete, under the ' +
   (thresholds.minCompleteness * 100).toFixed(1) + '% floor - unfinished, not defective');
 }
 if (evidence.highConfidenceFindings === 0 && evidence.intentionalRiskFindings === 0) {
  return rule(11, 'IGNORE', 'no findings beyond untranslated keys; there is nothing to say to this project');
 }
 if (evidence.highConfidenceFindings < thresholds.minHighConfidence) {
  return rule(12, 'HUMAN_REVIEW', evidence.intentionalRiskFindings + ' finding(s), none of which survives "could this be ' +
   'on purpose?"; a human decides whether any of them is worth raising');
 }
 if (evidence.noiseRatio > thresholds.maxNoiseRatio) {
  return rule(13, 'IGNORE', evidence.highConfidenceFindings + ' high-confidence finding(s) among ' +
   (evidence.highConfidenceFindings + evidence.intentionalRiskFindings) + ' citable ones (noise ratio ' +
   evidence.noiseRatio + ' > ' + thresholds.maxNoiseRatio + '); the signal is buried');
 }

 if (contact.posture === 'UNCHECKED') return rule(14, 'HUMAN_REVIEW', contact.reason);
 if (metadata.activity === 'UNKNOWN') {
  return rule(15, 'HUMAN_REVIEW', 'repository activity is unknown; a dead repository is a contact spent for nothing');
 }
 if (asking && outstandingAxes.includes(asking)) {
  return rule(16, 'HUMAN_REVIEW', 'an answer on the ' + asking + ' axis is already outstanding from another contact; ' +
   'a second one buys no information we are not already about to get');
 }

 return rule(17, 'READY_FOR_REVIEW', evidence.highConfidenceFindings + ' high-confidence finding(s) on a ' +
  (evidence.localeCompleteness * 100).toFixed(1) + '% complete locale, no contact history, activity ' + metadata.activity);
}
