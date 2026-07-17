# Repo migration — cutoff + runbook (`openmobilehub/credentagent`)

> **STATUS: COMPLETED — historical record. Do not execute.**
> This migration shipped: `openmobilehub/credentagent` (**this repo**) *is* the migrated repo. The
> runbook below is preserved for provenance and is written in the future tense of its time.
> **If it is ever reused as a template, one correction:** the `STATUS.md` practice it ports (the
> table below and runbook step 2) was **retired 2026-07-16**. Project state now lives in GitHub —
> `gh issue list --label needs-decision` for decisions, epics + sub-issues for what's in flight,
> merged PRs for what's done (see CLAUDE.md → "Status & decisions"). **Do not recreate a status file.**

The credentagent packages move to their own repo. This defines **when** (the cutoff) and **how** (the runbook).
Decision context: the maintainer decisions of 2026-06 (since migrated to `needs-decision` issues).
**Re-sequenced 2026-06-28 (maintainer):** the migration is now the **next
priority**, and `0.1.0` is published **FROM the new repo** (together with the dev + reference docs) — not from
this repo first.

## The cutoff (when to migrate)

**The trigger is now MET:** the **003 cutover is done** — the demo is a thin consumer (consumes the packages
via the workspace; `payment-gate/` ceremony + the old demo impl retired; build + suite green). The packages
are self-contained, so the move is mechanical, not a refactor. **→ Migrate next.**

**Publish from the new repo:** `0.1.0` is published from `openmobilehub/credentagent` (gate then storefront) once
the repo + its CI + the dev/reference docs are in place — NOT from this repo. After it publishes, this repo's
demo flips its dependency from the workspace packages to the published `@openmobilehub/credentagent-*` (`^0.1.x`).

**Optional backstop date** _(was confirmed in the status file of the time; that file is retired)_**:** if the dedicated repo is wanted as the public *front
door* for the GDC talk, stand it up by **~1 week before GDC (≈ 2026-08-25)**.

**Sequence:** cutover ✅ → **migrate (packages + docs → new repo)** → **publish `0.1.0` from new repo** →
flip this repo's demo to the published dep.

## What moves vs stays

| Moves to `openmobilehub/credentagent` | Stays in this repo (the demo) |
| :-- | :-- |
| `packages/credentagent-gate/`, `packages/credentagent-storefront/` | `app.ts` / `server.ts` / `src/` widget / Vercel deploy |
| `examples/`, `docs/PUBLISHING.md`, `docs/naming-clearance.md` | `payment-gate/` (only if the 003 tail hasn't deleted it yet) |
| Specs `001`/`002`/`003`/`004` (package-scoped) | `catalog.ts`/`checkout.ts` demo glue, `api/index.ts` |
| The package-relevant slice of `CLAUDE.md` | Demo-specific CI / Vercel config |

## Runbook (steps, in order)

1. **History-preserving extract.** Use `git filter-repo --path packages/credentagent-gate --path packages/credentagent-storefront --path examples --path specs` (or `git subtree split`) into a fresh `openmobilehub/credentagent` repo so blame/history survive. (Plain copy loses history — avoid.)
2. **Port tooling to the new repo:** `.github/workflows/claude-code-review.yml` (re-point validation), DCO enforcement, a build/test/**publish** workflow, branch protection (human review required), and a root `CLAUDE.md` (lift the package-relevant invariants). _No status file — project state belongs in GitHub issues; see the banner above._
3. **Restructure for a library root:** the two packages become the repo's workspaces; root README = the product front door (currently `packages/credentagent-gate/README.md` content); wire `npm run build` / `npm test` at the new root.
4. **Flip the demo's dependency** (in THIS repo): demo `package.json` deps on `@openmobilehub/credentagent-*` move from `workspace:*` → published `^0.1.x`; drop the moved packages from this repo's workspace config; `npm install`; full suite green.
5. **Publish from the new repo thereafter.** Future `0.1.x`/`0.2.0` publish from `openmobilehub/credentagent`, not here. Order stays: gate before storefront (`docs/PUBLISHING.md`).
6. **Verify + retire.** New repo CI green + a `0.1.x` published from it + the demo green against the published version → only THEN remove `packages/` from this repo. Keep this repo's copy buildable until the new repo is proven (rollback safety).

## Rollback

Until step 6 completes, this repo still builds the packages, so a failed migration is a no-op revert. Don't
hard-`rm` `packages/` here until the new repo has shipped a working `0.1.x` and the demo is green against it.

## Open items to confirm

- The **backstop date** (≈ 2026-08-25) — only if you want the public repo before the GDC talk.
- Whether specs `001`–`004` move with the packages or stay as the demo's design record (recommend: move, they're package design).
