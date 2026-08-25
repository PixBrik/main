# PixBrik (repo "Fotobrik")

Photo → AI 3D mesh → voxels → real GoBricks parts + prices → buildable brick
kit. Live at https://www.pixbrik.com. New here? Read
`docs/handover/HANDOVER.md` first — it is the canonical orientation document.

## Layout

- `apps/mobile` — the product. Expo/React-Native exported to **web** (native is
  stubbed), plus Vercel serverless functions in `apps/mobile/api/`. Deploys to
  pixbrik.com; Vercel Root Directory = `apps/mobile`.
- `apps/admin` — separate Next.js + Postgres backoffice, its own Vercel project
  (`pixbrik-backoffice.vercel.app`); storefront redirects `/backoffice/*` there.
- `tools/catalog/` + `data/gobricks/` — builders for
  `apps/mobile/src/data/brickCatalog.json` (the live parts catalog).
  `catalog/` (Python/SQLite) is a divergent older system — not what the app reads.
- `docs/` — briefs & runbooks; `project-brief.md`, `demo-script.md`,
  `mvp-backlog.md` are stale, prefer `handover/HANDOVER.md`.

## Commands

```powershell
cd apps/mobile
npm run web        # local dev (NO /api locally — serverless needs Vercel or `vercel dev`)
npm run check      # typecheck (app AND api via tsconfig.server.json) + 198 node tests
```

Run `npm run check` before every push. Push to `main` = production deploy.

## Key code

- `src/lib/brickify.ts` — THE engine (~2,400 lines): rectangle packer, slope /
  curvature / sculpt / terrace / studless passes, wheels, pricing
  (`BUNDLE_MARKUP = 0.9`). Passes are ordered and interdependent — read the
  section markers before editing.
- `src/lib/photoEngine/` — capture AI (SlimSAM, CLIP, depth, face features),
  `imageTo3D.ts` (Tripo + Meshy orchestration), `meshVoxelize.web.ts`
  (mesh→voxel), `meshFidelity.ts` (colour-truth passes).
- `api/` — serverless: `tripo/*`, `meshy/*` (3D providers, keys server-side
  only), `background/remove`, `guides/share`, `contact`, backoffice bridge.
  Helpers `_generationSecurity.ts` (cost circuit breaker), `_studioSession.ts`
  (owner-only HMAC session), `_modelStream.ts` (streams GLBs past the 4.5 MB cap).
- `App.tsx` — hand-rolled router (no React Navigation); `window.__spin` is the
  dev harness for renderer/technique experiments.

## Invariants (hard-won — do not regress)

1. **No secrets in the tree, ever.** Public repo. Keys live in Vercel env vars
   + gitignored `apps/mobile/.env.local` only. Grep staged diffs for `tsk_`,
   `msy_`, `re_`, `sk_` before committing.
2. **Provider calls cost real money** (~30 Tripo credits/build). Keep
   `face_limit` ≈ 10000 and cheap model versions (`v2.0-20240919`) — meshes get
   voxelized to coarse bricks, fidelity above that is wasted spend. Never
   weaken `_generationSecurity`.
3. **Colour must never change approved geometry** — that is why `meshFidelity`
   is a separate layer from `meshVoxelize`. Keep it that way.
4. **`kitAssessment` is the release gate**: any packing change must still yield
   a valid assembly plan. Tests enforce this — keep them green.
5. **Honesty labelling is a product rule**: every displayed number/model is
   labelled real / estimate / demo fixture (`docs/architecture.md`). Checkout
   is a prototype (no payment processor) — do not make it look otherwise.
6. **Large meshes freeze the tab** — voxelize one profile, keep meshes small at
   the source (`TRIPO_FACE_LIMIT`), never run the res-64 grid on a full-size
   provider mesh on the main thread.
7. **Vercel env-var changes need a redeploy** to take effect.

## Current frontier (see HANDOVER §7)

312 staged "extended" parts await calibration (`brickCatalog.json.extended[]`,
unread today); HD/plate technique is finished but dev-only (`window.__spin`);
`src/lib/commerce/` is built+tested but not wired to checkout; distributed rate
limiting (Vercel Firewall) is a marked launch blocker; long-term vision is a
render→compare→refine self-correcting loop against the source photo.
