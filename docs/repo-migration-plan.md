# Repo migration — cutoff + runbook (`openmobilehub/attesto`)

The attesto packages move to their own repo. This defines **when** (the cutoff) and **how** (the runbook).
Decision context: `STATUS.md` (split → after `0.1.0` publish) and the naming call (proceed as Attesto).

## The cutoff (when to migrate)

**Primary trigger — migrate when BOTH are true:**
1. **003 tail merged** — the demo is a thin consumer (consumes the packages; `payment-gate/` retired), so
   the packages are self-contained and the move is mechanical, not a refactor. (`specs/003-…/tail-implementation-plan.md`)
2. **`0.1.0` published to npm** — the demo then depends on the published `@openmobilehub/attesto-*` (`^0.1.x`),
   so lifting `packages/` out of this repo doesn't break the demo's build.

**Backstop date — _proposed, confirm in `STATUS.md`_:** if the dedicated repo is wanted as the public *front
door* for the GDC talk, do the migration **no later than ~1 week before GDC (≈ 2026-08-25)** regardless of the
triggers — publishing from this repo first is fine; the public repo can be created at/just before launch.
If the repo is _not_ needed as a pre-talk front door, just fire on the primary trigger (no date pressure).

**Do NOT migrate before both triggers** — moving mid-extraction reintroduces the cross-repo publish/link loop
the monorepo avoids during the 003 tail.

## What moves vs stays

| Moves to `openmobilehub/attesto` | Stays in this repo (the demo) |
| :-- | :-- |
| `packages/attesto-gate/`, `packages/attesto-storefront/` | `app.ts` / `server.ts` / `src/` widget / Vercel deploy |
| `examples/`, `docs/PUBLISHING.md`, `docs/naming-clearance.md` | `payment-gate/` (only if the 003 tail hasn't deleted it yet) |
| Specs `001`/`002`/`003`/`004` (package-scoped) | `catalog.ts`/`checkout.ts` demo glue, `api/index.ts` |
| The package-relevant slice of `CLAUDE.md` + `STATUS.md` practice | Demo-specific CI / Vercel config |

## Runbook (steps, in order)

1. **History-preserving extract.** Use `git filter-repo --path packages/attesto-gate --path packages/attesto-storefront --path examples --path specs` (or `git subtree split`) into a fresh `openmobilehub/attesto` repo so blame/history survive. (Plain copy loses history — avoid.)
2. **Port tooling to the new repo:** `.github/workflows/claude-code-review.yml` (re-point validation), DCO enforcement, a build/test/**publish** workflow, branch protection (`claude-review` + human review required), a root `CLAUDE.md` (lift the package-relevant invariants + the `STATUS.md` practice), and `STATUS.md` itself.
3. **Restructure for a library root:** the two packages become the repo's workspaces; root README = the product front door (currently `packages/attesto-gate/README.md` content); wire `npm run build` / `npm test` at the new root.
4. **Flip the demo's dependency** (in THIS repo): demo `package.json` deps on `@openmobilehub/attesto-*` move from `workspace:*` → published `^0.1.x`; drop the moved packages from this repo's workspace config; `npm install`; full suite green.
5. **Publish from the new repo thereafter.** Future `0.1.x`/`0.2.0` publish from `openmobilehub/attesto`, not here. Order stays: gate before storefront (`docs/PUBLISHING.md`).
6. **Verify + retire.** New repo CI green + a `0.1.x` published from it + the demo green against the published version → only THEN remove `packages/` from this repo. Keep this repo's copy buildable until the new repo is proven (rollback safety).

## Rollback

Until step 6 completes, this repo still builds the packages, so a failed migration is a no-op revert. Don't
hard-`rm` `packages/` here until the new repo has shipped a working `0.1.x` and the demo is green against it.

## Open items to confirm

- The **backstop date** (≈ 2026-08-25) — only if you want the public repo before the GDC talk.
- Whether specs `001`–`004` move with the packages or stay as the demo's design record (recommend: move, they're package design).
