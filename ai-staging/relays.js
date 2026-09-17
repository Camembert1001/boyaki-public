// Canonical BOYAKI Nostr relay set.
//
// Every page that publishes or queries BOYAKI content (raw posts, profiles,
// account-link proofs, deletions) must use this SAME list. Nostr relays do
// not sync with each other: an event that only reached one relay is
// invisible to any page that queries a different relay subset, regardless
// of identity/account/browser correctness. `app.js` was widened to this
// 8-relay list (commit ec104ba, "Add broader relay set and publish
// diagnostics") to make publishing reliable; every other page kept the
// original 2-relay list and could therefore miss content app.js itself
// published successfully. See H-I0001 Identity Continuity root-cause notes.
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://relay.current.fyi',
  'wss://brb.io',
  'wss://relay.nostr.net',
  'wss://relay.nostrcheck.me',
];
