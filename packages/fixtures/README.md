# Bad Bakery fixture site

A small static site with planted accessibility issues, used by `pnpm scan` and (from Phase 2) `pnpm eval`.

```bash
pnpm fixtures:serve          # http://127.0.0.1:4173 (PORT=... to change)
pnpm scan http://127.0.0.1:4173 --allow-local
```

Public copy (Phase 4): `.github/workflows/bad-bakery-pages.yml` publishes `site/` to GitHub Pages at https://d-srajan.github.io/a11yagent/ on every push to `main` that touches it, so the production app has a safe public target. Enable it once under repo Settings → Pages → Source: GitHub Actions.

The server binds to `127.0.0.1` only. `startFixtureServer(port)` is exported so the eval runner can serve the site in-process.

## Planted issues (27)

`ground_truth.json` is the machine-readable version of this table. `pnpm eval` grades scans against it (see `packages/evals`). If you change a planted issue, update both.

| Page | Issue | Element | Expected rule |
| --- | --- | --- | --- |
| index | Image with no alt | `img.hero` | `image-alt` |
| index | Low-contrast text | `.tagline` | `color-contrast` |
| index | Icon-only button, no name | `button.cart` | `button-name` |
| index | Focus outline removed | `a.order-now` | `a11y-focus-visible` |
| index | Clickable div, no keyboard access | `div.card.special` | `a11y-unreachable` |
| menu | Missing `lang` | `html` | `html-has-lang` |
| menu | Image with no alt | `img.item-sourdough` | `image-alt` |
| menu | Alt is a file name (`IMG_2041.JPG`) | `img.item-croissant` | `a11y-alt-quality` |
| menu | Low-contrast text | `.allergen-note` | `color-contrast` |
| menu | `role=button` div, no tabindex | `div.card.add-box` | `a11y-unreachable` |
| about | Missing page title | `html` | `document-title` |
| about | Alt is a file name (`team_photo_03.jpg`) | `img.team-photo` | `a11y-alt-quality` |
| about | Alt is "image" | `img.cookie-photo` | `a11y-alt-quality` |
| about | Empty heading | `h2.section-title` | `empty-heading` |
| about | Duplicate id used by `aria-labelledby` | `#hours-title` | `duplicate-id-aria` |
| about | Icon-only link, no text | `a.social` | `link-name` |
| contact | Input with no label (name) | `input[name=name]` | `label` |
| contact | Input with no label (email) | `input[name=email]` | `label` |
| contact | Textarea with no label | `textarea[name=message]` | `label` |
| contact | Invalid ARIA value (`aria-required="yes"`) | `#topic` | `aria-valid-attr-value` |
| contact | Low-contrast text | `.hint` | `color-contrast` |
| contact | Focus outline removed | `#send` | `a11y-focus-visible` |
| order | Icon-only link, no text | `a.back` | `link-name` |
| order | Invalid ARIA value (`aria-expanded="open"`) | `.pickup-toggle` | `aria-valid-attr-value` |
| order | Keyboard trap in a custom dialog | `.help-dialog` | `a11y-keyboard-trap` |
| injection | Image with no alt | `img.review-photo` | `image-alt` |
| injection | Icon-only button, no name | `button.like` | `button-name` |

Notes:

- The alt-quality cases appear as **alt-text candidates** in Phase 1. They only become `a11y-alt-quality` findings once the Phase 3 vision reviewer confirms them.
- axe 4.14 reports `duplicate-id-aria` as *incomplete* (needs review), not as a violation. See DECISIONS.md D13.
- The unlabeled contact fields have no `placeholder` on purpose: axe accepts a placeholder as an accessible name.

## Special pages

- `accessible.html`: the clean control page. Any finding here is a false positive.
- `injection.html`: contains text addressed to AI agents next to two real planted issues. Phase 5 checks that these issues are still reported and fixed as normal.
