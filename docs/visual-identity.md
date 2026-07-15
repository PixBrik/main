# Visual identity: Signal Workshop

## Idea

Fotobrik should feel like creative software with the energy of a design studio: confident enough for young adults, direct enough for first-time builders, and playful through interaction rather than childish decoration.

The generated model is the hero. Dark technical stages, electric signals, an editorial grid, and a sharp angular wordmark make the product recognizable without copying toy packaging, instruction books, or another company's visual language.

## Signature ingredients

- Warm neutral canvas: **#F3F1EA**
- Graphite ink: **#111315**
- Dark model stage: **#171A21**
- Electric indigo action colour: **#4F46E5**
- Bright indigo signal: **#716BFF**
- Coral capture state: **#FF6B57**
- Aqua validation state: **#A9F4DE**
- Acid micro-accent only: **#C8F04B**
- The angular Fotobrik FB/capture-frame mark on every screen
- Thin technical grids, tabular metrics, short status labels, and restrained square corners
- Direct verbs: Capture, Generate, Inspect, Source, Build

The identity gets its fun from the rotatable voxel model, live angle readout, scan states, and high-contrast signals—not pastel blobs, cartoon outlines, confetti, or overly juvenile copy.

## Stage signals

Each phase of the Capture → Model → Source → Build flow owns one signal colour, defined in `theme/tokens.ts` as the `signals` map:

- **Capture** — coral (`coral`, deep `#C2371E`, soft `#FFE5DE`)
- **Model** — electric indigo (`indigo`)
- **Source** — aqua/mint (`mint`, deep `#087A5B`, soft `#DCFBF1`)
- **Build** — acid lime (`saffron`, deep `#5C7500`, soft `#F0FAD0`)

Rules:

1. Every screen passes its stage's signal to `ScreenFrame` via the `accent` prop. The frame renders the four-segment signal rail under the brand header (the active stage's segment is widened), the tinted eyebrow chip, the title underline bar, and the progress fill in that signal.
2. `main` is the raw signal for rails, ticks, and marks on dark or neutral surfaces. `deep` is the contrast-safe counterpart for text and for fills that carry white type. `soft` is the tinted surface behind them. Never put `main` mint or saffron behind white text.
3. Selected states are colour-filled, not merely outlined: chips fill with the group's `deep` signal, choice strips tint with `soft` and keep an ink border, dock tabs underline and colour their mark with the destination's signal.
4. The primary button carries a hard offset shadow in a contrasting signal (indigo button / acid shadow) instead of a plain ink drop.

## Layout rules

1. Keep the full Fotobrik mark in the persistent header; use the compact mark only when horizontal space is genuinely constrained.
2. Give every screen one dominant action in the thumb zone.
3. Make previews large and interactive. Data and controls support the model rather than competing with it.
4. Use warm canvas and white surfaces for most UI; reserve the graphite stage for 3D, pipeline, and navigation moments.
5. Use radius 6–16 for surfaces. Pill geometry is limited to compact status chips.
6. Keep borders thin and remove ornamental rotations. One electric rail or offset is enough to create energy.
7. After generation, use the four-item dock: **3D · Parts · Source · Build**.
8. Pair every colour state with a label, icon, percentage, or timestamp.

## Type and motion

Use a modern geometric sans with strong medium and bold weights. Space Grotesk is the current recommendation after licence and device-coverage review. System fonts remain the dependency-free prototype fallback. Metrics, IDs, angles, prices, and timestamps use tabular numerals.

Motion follows creative-tool behaviour:

- horizontal drag continuously orbits the generated model;
- controls update the live viewing angle;
- scan and pipeline states advance with restrained signal changes;
- selected build profiles change the model accent and data without celebration effects;
- reduced-motion mode keeps the same states and accessible rotate controls.

No motion delays a target or hides processing time.

## Voice

Prefer:

- “Scan locked”
- “Generate build”
- “Rotate the model”
- “Complete parts manifest”
- “98% findable”
- “Prototype snapshot / not live”
- “Local sourcing”

Avoid:

- “Ta-da”
- “Tiny reasons”
- “Little workshop”
- “AI magic”
- “Perfect replica”
- “Guaranteed in stock”
- childish or collector-only jargon without explanation

## Brand separation

Do:

- use the Fotobrik name and original angular mark after trademark clearance;
- create original icons, renders, geometry, and instructional diagrams;
- describe the product as an independent build-planning tool;
- show provider attribution only where required and approved;
- use neutral compatibility wording after legal review.

Do not:

- use another brick company's name, logo, character silhouette, packaging, product photography, instruction layout, or store trade dress as Fotobrik branding;
- make red plus yellow the lead palette;
- shape the Fotobrik wordmark like studs or imitate a known toy logo;
- call generated models official or imply sponsorship;
- import third-party imagery merely because its textual data is usable.

## Accessibility baseline

- Meet WCAG AA contrast for text and essential controls.
- Keep touch targets at least 44 × 44 pt or the platform equivalent.
- Give the logo, progress, preview modes, 3D viewer, and rotation controls explicit semantics.
- Support drag plus rotate-left, rotate-right, reset, and screen-reader adjustable actions.
- Never communicate availability, rarity, freshness, or errors through colour alone.
- Keep a static build view, complete BOM, and ordered text instructions for users who cannot manipulate 3D.
