# JP UI Preflight

Free, offline Japanese game UI preflight for indie developers.

**Public tool:** https://camembert1001.github.io/boyaki-public/yn0-jp-ui-preflight/

## Why it exists

Japanese game UI can be mechanically valid while still shipping with avoidable implementation risks: placeholder drift, kinsoku line-break problems, half-width kana, ideographic spaces, inconsistent punctuation, and layout pressure.

JP UI Preflight catches those deterministic / heuristic risks before in-game linguistic and visual LQA.

## Checks

- missing / empty Japanese values
- EN/JA placeholder mismatch
- half-width katakana
- ideographic spaces
- leading / trailing whitespace
- explicit Japanese kinsoku line-start / line-end risks
- approximate display-width risk
- mixed punctuation styles

Everything runs locally in the browser. Project strings are not uploaded.

## Try the real sample

The tool can load the bundled 40-string EN↔JA sample directly into the checker, or you can download `sample.csv`.

## Practical guides

- Japanese UI QA: mechanical checks vs project style rules  
  https://camembert1001.github.io/boyaki-public/yn0-jp-ui-preflight/japanese-ui-localization-qa.html
- Godot Japanese localization checklist  
  https://camembert1001.github.io/boyaki-public/yn0-jp-ui-preflight/godot-japanese-localization-checklist.html
- Unity Japanese localization checklist  
  https://camembert1001.github.io/boyaki-public/yn0-jp-ui-preflight/unity-japanese-localization-checklist.html

## License

The free tool and 40-string sample are available under the MIT terms in `LICENSE.md`.

## Paid companion being validated

**JP Game UI Kit** expands the starter set to 410 EN↔JA game UI strings and adds Godot / Unity-ready CSVs, Japanese UI style guidance, engine import notes, and a release checklist. Planned launch price: **$5**.

If that would be useful, signal interest here:

https://github.com/Camembert1001/boyaki-public/issues/new?title=JP%20Game%20UI%20Kit%20interest&body=I%27m%20interested%20in%20the%20full%20410-string%20JP%20Game%20UI%20Kit.

Found a false positive or missing mechanical check? Report it here:

https://github.com/Camembert1001/boyaki-public/issues/5

## Scope

This is AI-assisted production tooling, not professional human localization. Heuristics can produce false positives; run in-context linguistic and visual LQA before release.

Keywords: Japanese game localization, Japanese UI, gamedev localization QA, Godot localization, Unity Localization, kinsoku, Japanese typography.
