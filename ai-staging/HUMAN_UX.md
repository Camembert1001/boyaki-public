# AI-STAGING Human UX vocabulary

This file is the SSOT for user-facing terminology in AI-STAGING.

## Public vocabulary

The primary UI should use only these BOYAKI-specific nouns:

- **BOYAKI** — the person's original, lightweight complaint / frustration.
- **Voice** — the person who has the pain, tests a solution, or states conditions. Explain in Japanese where first introduced.
- **Maker** — the person who asks, builds, and delivers a solution. Explain in Japanese where first introduced.
- **Product** — the purchasable/deliverable result.

Everything else should be ordinary Japanese.

### Main journey

**ボヤく → 話し合う → 一緒に解決 → Product**

### Preferred Japanese labels

| Internal concept | Human UX label |
| --- | --- |
| Thread | 話し合い |
| Shared Problem / Problem Statement | みんなで解く困りごと / 残る困りごと |
| Solution Room | 一緒に解決 |
| Solution Case | 解決メモ |
| Solution Log | 話し合いの記録 |
| Action Inbox | やること |
| Problem Market | 問題を探す |
| Maker Space | Makerページ |
| publish-back | 元の困りごとに掲載 |
| Demand Evidence / demand signal | 需要の反応 |

## Navigation

Primary navigation is fixed to:

**ホーム / 問題を探す / Product / マイページ**

Do not add internal workflow destinations to global navigation. Contextual back-links are allowed.

BOYAKIとは？ is contextual help, not a primary navigation destination.
バグ報告 is a secondary/support destination.

## Rules

1. Do not expose DB/API/domain-object names just because they exist internally.
2. Do not stack multiple synonymous labels on the same screen.
3. Prefer a verb describing what the person can do now over a system noun.
4. A user should not need to learn Thread, Shared Problem, Solution Room, Solution Case, Action Inbox, or Problem Market.
5. Technical environment wording such as AI-STAGING DB, normal STAGING, canonical, Nostr, or cutover belongs in diagnostics, not ordinary Human UX.
6. Test-payment disclosure must remain clear, but it should say simply that this is a test and no real money moves.
7. If a new feature requires a new public BOYAKI-specific noun, add it here deliberately before adding it to the UI.
