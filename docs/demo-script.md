# Demo script: from photo to build path

## Demo contract

This walkthrough is a deterministic prototype story, not a live AI or shopping integration. Use an original sample object and Fotobrik-authored renders. Label all parts, prices, stock, stores, and processing states as **Demo data**. Do not use real retailer logos unless separately approved.

Target: a first-time user reaches a useful result in under two minutes without narration. Presenter version: five to seven minutes.

## Prepared fixture

- An original, visually simple desk object with a clean background.
- Three precomputed interpretations: Efficient, Balanced, and Detailed.
- A versioned demo catalog and reproducible BOM for each interpretation.
- One fictional online route and two fictional nearby-store cards, all visibly marked Demo.
- One store card with "Wall contents unverified" to demonstrate honest freshness.

## Walkthrough

### 1. Home - "Shoot it. Build it."

Show the Signal Workshop canvas and its technical Build Flow. The Fotobrik mark remains visible in the header. Tap **Create a build**.

Presenter note: "There is one clear start. The flow carries the journey without turning the app into a generic tab dashboard."

Acceptance cue: capture choices are understandable, and the privacy note is visible before upload.

### 2. Capture mode

Choose **360 capture** for the complete demo path. **Single photo** remains available as the faster option. Open the camera, frame the object inside the asymmetric scan target, and capture.

Acceptance cue: the user can retake, choose a photo, or continue; no hidden upload occurs before consent.

### 3. Scan mock - confirm the subject

Animate the signal frame around the detected silhouette, then show the isolated subject. Tap **Use scan**.

If detection is uncertain, show two subject choices and ask the user to pick. The demo may be precomputed, but it must use the same UI as a real uncertainty state.

Acceptance cue: crop and background corrections are reversible.

### 4. Tune the build

Present three plain-language controls:

- Size: Compact / Large
- Detail: Efficient / High detail
- Palette: Source colours / Neutral / High contrast

Country defaults to the device region but is editable. Choose **Large**, **High detail**, **Source colours**, and **France**. Tap **Generate build**.

Acceptance cue: show an approximate range, not a fake exact count, before generation.

### 5. Build pipeline

The flow advances through four truthful stages:

1. Capture
2. Model
3. Source
4. Build

In the prototype, show **Demo simulation** near the progress state. Allow cancel/back; never use an endless spinner.

Acceptance cue: reduced-motion mode shows the same stages without flying pieces.

### 6. Interactive 3D reveal

Reveal the projected voxel model on a dark inspection stage. Drag horizontally to rotate it, use the left/right controls for fixed increments, and use reset to return to the hero angle. Show:

- live viewing angle;
- piece count;
- approximate finished dimensions;
- difficulty;
- pinned demo catalog version;
- a short assumption: "Based on one front photo; hidden surfaces are interpreted."

Switch once to **Build view** to demonstrate the gesture-free fallback, then return to **3D model**.

The Build Flow resolves into the post-result dock: **3D / Parts / Source / Build**. The Fotobrik mark remains visible.

Acceptance cue: the default result is understandable without rotating the model, and all rotation controls have accessible actions.

### 7. Compare variants

Switch between:

- **Efficient:** fewer pieces and a faster build;
- **Balanced:** the default compromise between silhouette, stability, and count;
- **Detailed:** more pieces and surface definition.

Change to Efficient and confirm that count, dimensions, and trade-off copy update together.

Acceptance cue: every variant explains its trade-off in one sentence and retains the user's chosen size.

### 8. Parts manifest

Open **Parts**. Filter the BOM using **All parts**, **Common**, and **Alternatives**. Each row shows the Fotobrik ID, source references where permitted, dimensions, quantity, and confidence.

Open one row, then choose an approved substitute. Return to the BOM and show the updated piece count.

Acceptance cue: totals reconcile exactly with the selected variant and substitution.

### 9. Source routes

Tap **Compare sourcing** and confirm France. Show three clearly separated concepts:

- Fewest parcels
- Lowest total
- Official catalog

Every demo card says Demo data. A live version must show provider, destination, condition, observed time, and expiry. Nearby cards say "Wall available - contents unverified" unless exact contents have a fresh approved source.

Acceptance cue: changing country invalidates old offer cards before loading new ones; no stale price survives under the new country.

### 10. Local sourcing

Open **View nearby options**. Explain that a store directory and exact wall inventory are different facts. Demonstrate the freshness label and the unverified-inventory state.

Acceptance cue: the app never implies guaranteed physical stock without current approved evidence.

### 11. Assembly guide

Open **Build** or tap **Open assembly guide**. Move from foundation to finish. Each step highlights newly added pieces and offers a text alternative. Use Back/Next and confirm the selected step is always obvious.

Acceptance cue: the BOM used by all steps equals the selected variant BOM, and a user can resume at the last completed step.

## Recovery moments to demonstrate

- **Poor photo:** suggest more light, a plain background, or a different angle.
- **Unsupported shape:** offer a flat mosaic interpretation rather than pretending a stable 3D build exists.
- **Unavailable colour:** show a one-tap closest-palette alternative.
- **No fresh purchase observations:** keep the BOM/export and say "No current routes found" rather than "Out of stock."
- **Store sighting expired:** hide it from current results or label it expired; never refresh the timestamp without new evidence.

## Demo success checklist

- No third-party data is presented as live.
- All counts reconcile across 3D, Parts, Source, and Build.
- Back navigation preserves choices.
- The Fotobrik mark appears on every page.
- One-hand operation reaches every primary action.
- Screen-reader and reduced-motion paths can complete the story.
- Third-party toy-company names, logos, product art, and official instruction styling are absent from Fotobrik branding.
