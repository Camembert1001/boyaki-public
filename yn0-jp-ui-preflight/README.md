# JP UI Preflight

Free, offline Japanese game UI preflight for indie developers.

**Public tool:** https://camembert1001.github.io/boyaki-public/yn0-jp-ui-preflight/

## Checks

- missing / empty Japanese values
- EN/JA placeholder mismatch
- half-width katakana
- ideographic spaces
- leading / trailing whitespace
- explicit Japanese kinsoku line-start / line-end risks
- approximate display-width risk
- mixed punctuation styles

The checker runs locally in the browser. Project strings are not uploaded.

## Free sample

The same directory contains `sample.csv` with 40 common EN↔JA game UI strings.

## Paid companion being validated

**JP Game UI Kit** expands the starter set to 410 EN↔JA UI strings and adds Godot / Unity-ready CSVs, Japanese UI style guidance, engine notes, and a release checklist. Planned launch price: **$5**.

If that would be useful, open an interest issue:

https://github.com/Camembert1001/boyaki-public/issues/new?title=JP%20Game%20UI%20Kit%20interest&body=I%27m%20interested%20in%20the%20full%20410-string%20JP%20Game%20UI%20Kit.

## Scope

This is AI-assisted production tooling, not professional human localization. Heuristics can produce false positives; run in-context linguistic and visual LQA before release.
