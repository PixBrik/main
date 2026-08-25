# PixBrik — Project Handover

*Prepared 25 Aug 2026 for the incoming maintainer. Start here; everything else links out.*

PixBrik (repo name "Fotobrik") turns a photo of a real object into a buildable
brick model: photo → AI 3D mesh → voxel grid → real GoBricks parts with prices
→ bill of materials → assembly guide → (future) paid kit. Live at
**https://www.pixbrik.com**.

This document tells you: what exists, what is real vs prototype, which accounts
and secrets you need to receive, how to run and deploy, and what to do next.
For working with Claude: the repo root has a `CLAUDE.md` that Claude Code reads
automatically — your Claude sessions start pre-briefed.

---

## 1. The 60-second tour

- **One repo, two deployed apps.**
  - `apps/mobile` — the storefront: an Expo/React-Native app exported to web,
    plus Vercel serverless functions under `apps/mobile/api/`. Deploys to
    pixbrik.com (Vercel, Root Directory = `apps/mobile`).
  - `apps/admin` — a separate Next.js + Postgres backoffice
    (orders, customers, discounts, library publishing). Deploys separately to
    `pixbrik-backoffice.vercel.app`; the storefront redirects `/backoffice/*`
    there and talks to it server-to-server.
- **The crown jewel is the brick engine** —
  `apps/mobile/src/lib/brickify.ts` (~2,400 lines) and
  `src/lib/photoEngine/` (mesh voxelizer, colour-fidelity passes, SAM/CLIP/
  depth on-device AI). This is months of tuning; treat it with respect and run
  the tests after every change.
- **Money flows out, not in (yet).** 3D generation (Tripo/Meshy) costs real
  credits per call — protected by server-side keys, origin allowlists, and rate
  buckets. Checkout is an honest prototype: no payment processor is wired.
- **Honesty is a product rule.** Everything shown is labelled real / estimate /
  demo fixture. Keep it that way (see `docs/architecture.md`).

## 2. What is REAL vs PROTOTYPE today

| Area | Status |
|---|---|
| Photo capture, segmentation (SlimSAM), classification (CLIP), depth, face features | **Real**, on-device in the browser |
| Photo → 3D mesh (Tripo + Meshy, single & 4-view multiview) | **Real**, paid APIs behind `/api/tripo/*`, `/api/meshy/*` |
| Mesh → bricks (voxelize, slopes, curvature, packer, colour truth, terrace) | **Real** — the engine's core value |
| Parts, prices, SKUs, per-colour stock | **Real** — crawled GoBricks catalog (1,539 parts / 32k variants) in `src/data/brickCatalog.json` |
| Bill of materials, assembly plan, PDF guide, QR-shared guides (`/g/<id>`) | **Real** |
| Bundle pricing (parts + 90% service markup, full/hollow) | **Real math**, labelled prototype pricing |
| Checkout / payments | **Prototype** — device-local "reserved-demo" orders; NO payment processor |
| Shipping quotes in the UI | **Prototype numbers** (3-country table). A real zone/origin model exists in `src/lib/commerce/shipping.ts` but is not wired |
| Stores screen | **Demo fixture** |
| Progress screen | **Scripted animation**, not real progress |
| Accounts (Clerk) | **Real sign-in on web**; does not yet claim local builds/orders |
| Legal pages (5 locales) | Written but **gated off in production** until marked reviewed in `src/legal/legalGovernance.ts` |
| iOS/Android native | **Second-class**: the AI/render pipeline is web-only (native files are stubs). The product is effectively the web app today |

## 3. Accounts & secrets you must receive

The repo is **public** — no secret has ever been committed (verify any new
commit keeps it that way). Real values live in two places only: the Vercel
project's Environment Variables, and the gitignored local file
`apps/mobile/.env.local`. `. env.example` at the repo root documents every
variable with comments.

Transfer (or re-create + rotate) these accounts:

| Service | Used for | Env var(s) |
|---|---|---|
| **GitHub** — `PixBrik/main` | Source of truth; push to `main` auto-deploys | — |
| **Vercel** — storefront project | Hosting, serverless, env vars, Blob storage | `BLOB_READ_WRITE_TOKEN` |
| **Vercel** — backoffice project | `apps/admin` + its Postgres | `PIXBRIK_BACKEND_URL`, `PIXBRIK_BACKEND_SHARED_SECRET` |
| **Domain registrar** — pixbrik.com | DNS → Vercel | — |
| **Tripo** (platform.tripo3d.ai) | Photo→3D provider. ~410 credits remained mid-July; ~30 credits/build | `TRIPO_API_KEY` (+ `TRIPO_MODEL_VERSION`, `TRIPO_FACE_LIMIT`) |
| **Meshy** | Second 3D provider + owner text-to-3D for the library | `MESHY_API_KEY` |
| **Clerk** | Customer sign-in | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (+ secret key in backoffice) |
| **Resend** | Contact-form email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CONTACT_RECIPIENT_EMAIL` |
| **PhotoRoom / remove.bg** | Server background removal | `PHOTOROOM_API_KEY` / `REMOVE_BG_API_KEY` |

**On day one: rotate every key** (Tripo, Meshy, Resend, PhotoRoom/remove.bg,
Clerk secret, backend shared secret) and update Vercel + your local
`.env.local`. Keys were handled during development conversations; rotation
makes history irrelevant. Remember the Vercel gotcha: **env-var changes only
apply to deploys created after the change** — redeploy after editing.

Cost guardrails you inherit: `_generationSecurity.ts` fail-closed kill switch
(`GENERATION_API_ENABLED=1` required in production), origin allowlist, per-IP
hourly bucket, process-wide daily cap. These are in-memory (per warm instance)
— a distributed Vercel Firewall rule is a **known launch blocker** (see §7).

## 4. Run it locally

```powershell
cd apps/mobile
npm install
npm run web          # Expo web on http://localhost:8081 (launch config uses 8091)
npm run check        # typecheck (app + api) + 198 node tests — run before every push
```

- Copy `.env.example` → `apps/mobile/.env.local` and fill what you have.
- `expo start --web` has **no serverless runtime**: `/api/*` (Tripo, Meshy,
  background removal, guides, contact) only work on the Vercel deploy or via
  `vercel dev`. Everything else — capture, on-device AI, engine, BOM — works
  fully offline locally.
- Whole-repo verification incl. the Python catalog tests: `.\scripts\verify.ps1`.
- Useful dev hook: `window.__spin` in the browser console (see `App.tsx`)
  drives the renderer/technique A/B harness; the **Lab screen** is the owner
  playground for provider/technique comparisons.

## 5. Deploy

Push to `main` → Vercel builds the storefront (`npx expo export --platform web`
→ `dist/`, config in `apps/mobile/vercel.json` — SPA rewrite excludes `/api`,
model-streaming functions get 300 s). The backoffice deploys from `apps/admin`
as its own Vercel project. There is no staging environment; Vercel preview
deployments serve that role.

## 6. Architecture — where things live

```
apps/mobile/
├─ App.tsx                  hand-rolled router (no React Navigation), ~2,200 lines
├─ src/screens/             Home, Mode, Capture, Capture360, Preferences, Progress,
│                           Result, Bom, Purchase, Stores, Checkout, Instructions,
│                           Library, Lab (owner tool), Account, Contact, Legal*, SharedGuide
├─ src/lib/
│  ├─ brickify.ts           THE ENGINE: packing, slopes, curvature, sculpt, terrace,
│  │                        studless skin, wheels, pricing (BUNDLE_MARKUP = 0.9)
│  ├─ photoEngine/          detect/segment(SAM)/classify(CLIP)/depth/faceFeatures,
│  │                        imageTo3D (Tripo+Meshy orchestration), meshVoxelize,
│  │                        meshFidelity (colour truth), backgroundRemoval, textTo3D
│  ├─ brickRenderLDraw.web.ts  product-grade renderer (real LDraw part geometry)
│  ├─ instructions/         deterministic assembly plan (versioned)
│  ├─ commerce/             currency/fx/discounts/markets/shipping/checkoutRecovery
│  │                        — built + tested, NOT yet wired to checkout
│  └─ kitAssessment*        release gate: packing must yield a valid assembly plan
├─ api/                     Vercel functions: tripo/, meshy/, background/remove,
│                           guides/share, contact, backend bridge + library routes
│                           (helpers _generationSecurity, _studioSession, _modelStream…)
├─ src/data/brickCatalog.json  GoBricks catalog (63 colours, 173 active parts,
│                              +312 staged "extended" parts — see §7)
└─ tests/                   35 test files, node built-in runner

apps/admin/                 Next.js backoffice + Postgres (migrations 0001–0009)
catalog/                    Python SQLite catalog (currently divergent, see §7)
data/ + tools/catalog/      GoBricks/Rebrickable feeds → brickCatalog.json builders
docs/                       see the reading list below
```

**Reading list, in order:** this file → `docs/brick-engine-brief.md` (best
conceptual intro to the engine, slightly dated) → `docs/real-pipeline.md`
(honesty ledger) → `docs/commerce-launch-requirements.md` →
`docs/architecture.md` (guardrails & go-live gates). Be aware
`docs/project-brief.md`, `demo-script.md`, `mvp-backlog.md` are **stale**
(written ~40 engine commits ago).

## 7. Open work — the honest punch list

**Half-finished (high value):**
1. **312 "extended" parts are staged but invisible.** They sit in
   `brickCatalog.json.extended[]` with geometry + SKUs, all `calibrated: false`
   — nothing reads them yet. Calibrating orientations and admitting them to the
   packer is the biggest quality lever available.
2. **HD / mosaic / studless techniques are dev-only.** Only the `window.__spin`
   debug hook exercises them; every production path uses `'sculpted'`. The HD
   (plate-resolution) work is flagship quality but unreachable from the UI.
   Note HD currently skips slope/wheel shaping (needs its own j-scaling).
3. **Commerce library not wired.** `src/lib/commerce/` (~2,100 tested lines:
   currency, fx, discounts, markets, zone shipping, checkout recovery) exists;
   the UI still uses the 3-country prototype `shippingEstimate.ts` and the
   demo checkout. Wiring these + a payment processor = the path to revenue.

**Launch blockers (explicitly marked in code):**
4. Distributed rate limiting (Vercel Firewall) for `/api/contact`,
   generation endpoints, `/api/background/remove`, `/api/guides/share` — the
   in-memory buckets are per-instance only (`api/contact.ts:9` says LAUNCH BLOCKER).
5. Blob retention: expired shared guides are never deleted (no cron exists).
6. Legal pages are governance-gated off in production — flip
   `src/legal/legalGovernance.ts` only after review.

**Hygiene:**
7. `test-assets/` is untracked and not gitignored — decide (commit probes,
   ignore bundles).
8. `data/gobricks/details.ndjson` is 78 MB — over GitHub's warning threshold;
   consider Git LFS or regenerating on demand.
9. Two undocumented env flags: `EXPO_PUBLIC_3D_GENERATION_ENABLED`,
   `EXPO_PUBLIC_GUIDE_SHARE_ENABLED` (add to `.env.example`).
10. Refresh the stale docs (§6 reading list) once you're oriented.

**The long-term vision** (from the founder): a self-correcting engine —
render the brick model, compare against the source photo/mesh, refine colours
and shape, iterate until it's as close as bricks allow ("analysis by
synthesis"). The colour-truth passes in `meshFidelity.ts` are the first steps
down this road; the render-compare-refine loop has not been started.

## 8. Working with Claude on this project

- The root `CLAUDE.md` briefs every Claude Code session automatically —
  commands, invariants, gotchas. Keep it updated as the project evolves; it is
  the institutional memory that survives account changes.
- Golden rules that have served this project well:
  - `npm run check` before every push (typecheck covers `api/` via
    `tsconfig.server.json` — App-only checks miss it).
  - Never let a secret near the tree; grep the staged diff (`git diff --cached`)
    for `tsk_`, `msy_`, `re_`, `sk_` before committing.
  - Provider calls cost money: test against providers with a small script
    first (`curl` the balance endpoint), keep `face_limit` low (10k), and
    prefer the cheap model (`v2.0-20240919`) — meshes get voxelized anyway.
  - The engine's contract: colour changes must never alter approved geometry
    (that's why `meshFidelity` is separate from `meshVoxelize`), and any
    packing change must keep `kitAssessment` (the release gate) green.

## 9. Day-one checklist

- [ ] GitHub: get added to `PixBrik/main` (or transfer ownership), clone, `npm install`, `npm run check` passes
- [ ] Vercel: get access to both projects (storefront + backoffice); find the Environment Variables pages
- [ ] Rotate all API keys (§3); update Vercel + local `.env.local`; **redeploy**
- [ ] Verify prod after redeploy: `https://www.pixbrik.com/api/tripo/status?taskId=test` returns JSON (a Tripo error object means the key is wired; an HTML page or "not configured" means it isn't)
- [ ] Run one real generation end-to-end on pixbrik.com (clear single-subject photo → True 3D) and watch the Tripo credit balance move
- [ ] Read the §6 reading list
- [ ] Skim `apps/admin` and its `docs/database-security.md`, confirm you can log into the backoffice
- [ ] Pick your first project from §7 (suggestion: #2 — surface the HD technique in the UI; it's finished tech waiting for a switch)
