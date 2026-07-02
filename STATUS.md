# Project Status — AttestoMCP

_Single source of truth for what's done, what's next, and what's waiting on you._
_Updated **2026-07-05** · `main` · CI green._

> **How this file works.** Read it at the start of every working session and update it at the end. It is
> decisions-first: "Decisions for you" (each a checkbox + recommendation), then In flight / next, a rolling
> Done log (linked commits), then standing constraints. Keep it current.

---

## ⏳ Decisions for you

- [ ] **Publish `0.2.0`** (bumped from the never-published `0.1.0` for the `AttestoMCP` rename below — an
      exported class rename). Add the **`NPM_TOKEN`** secret (publish rights to the `@openmobilehub` scope),
      then cut a **GitHub Release** → `.github/workflows/publish.yml` publishes **gate first, then
      storefront** (with provenance). Or publish manually in that order. See `docs/PUBLISHING.md`.
- [ ] **Add the `CLAUDE_CODE_OAUTH_TOKEN` secret** + a `claude-code-review.yml` workflow if you want the
      automated PR review (the org-managed review also covers it).
- [ ] **GDC front-door timing / optional rename.** "AttestoMCP" is contested but chosen for now
      (`docs/naming-clearance.md` has a vetted rename fallback). Confirm before the public GDC push.
- [ ] **005 sequencing fork.** Ship merchant-side v0.1 (server-HMAC grants) first as the smallest
      increment, or re-scope 005 to the wallet-custody connector architecture directly? Recommendation:
      decide after the on-device spike (`specs/005-human-not-present/connector-architecture-design.md`
      §10/§12). Note: 005 builds on 004, which builds after publish — sequence against the demo timeline.
- [ ] **Confirm the 005 Group-A decisions** (D1–D3, still *tentative* per the 2026-07-01 discussion) + the
      Decision-13 constitution amendment — both gate `/speckit-plan` → `/speckit-implement` for 005.

---

## 🔨 In flight / next

- **Publish `0.2.0`** — blocked on the `NPM_TOKEN` secret (above). Pre-flight green (CI build+test).
- **Flip the reference demo** — once published, `openmobilehub/mcp-apps-shopping-demo` switches its dependency
  on `@openmobilehub/attestomcp-*` from the workspace to the published `^0.2.x`, and renames its own
  `AttestoMcp` / `attestoMcpManifest` imports to `AttestoMCP` / `attestoMCPManifest` (tracked in that repo,
  [#26](https://github.com/openmobilehub/attestomcp/issues/26)).
- **Cart Mandate (004)** — spec ready (`specs/004-cart-mandate/spec.md`); build after publish.
- **Storefront persistence (005)** — [#27](https://github.com/openmobilehub/attestomcp/issues/27) (epic #29).
  Full spec-kit set in `specs/005-storefront-persistence/`. `createStorefront({ storage: redisStorage(…) })`
  implemented on the working tree: builds all four stores over Upstash Redis (optional peer dep, lazy-loaded),
  in-memory stays the zero-config default, explicit per-slot injection still wins, per-order keying + namespace
  isolation, fail-closed. Storefront suite green (+12 tests). **Pending:** commit (DCO) + PR; demo slim-down
  (scope A) tracked in `mcp-apps-shopping-demo`.
- **HNP (005)** — big design day 2026-07-01 (branch `005-human-not-present`, pushed; no PR yet): the
  **connector-architecture design** (wallet-custody over MCP: stock Multipaz Wallet seals the Intent
  Mandate, a new wallet server signs bounded draws, a UPay-style verifier settles, Claude orchestrates
  holding nothing) + a delegation walkthrough + overnight desk-verification (key find: **EUDI SCA TS12's
  `PaymentTransaction` natively expresses our bounds** — `max_amount`, cumulative `total_amount`, window,
  payee — no custom transaction type needed; consent sheet renders only "• Payment", so the approve page
  carries the terms) + an AP2 field mapping + a DRAFT (unsent) Multipaz upstream proposal. Everything
  **tentative** pending the decisions above. Next concrete step: the on-device confirmatory spike
  (design doc §12).

---

## ✅ Done (rolling — newest first)

| What | Where |
| :-- | :-- |
| `AttestoMcp` → `AttestoMCP` brand-casing rename (class, `AttestoMCPOptions`, ~171 sites across code + docs), version bumped `0.1.0` → `0.2.0` | [#26](https://github.com/openmobilehub/attestomcp/issues/26) |
| Repo migrated out of `mcp-apps-shopping-demo` (history-preserved), CI green, branch protection on `main` | this repo |
| Dev + reference docs (`docs/reference/*`, README, ARCHITECTURE, CONTRIBUTING, SECURITY-INVARIANTS) | `docs/` |
| The full ceremony extraction (003): the demo became a thin consumer; the gate is the published library | `specs/003-…` |

---

## 📌 Standing constraints (don't regress)

- **The 6 security invariants** (`SECURITY-INVARIANTS.md`) — a change that breaks one is blocking, even in demo code.
- **Honesty:** `trust_level` stays `presence-only-demo` for the OpenID4VP rails (real wire crypto, no issuer
  trust anchor yet) — never sold as a real safety control. A pro trademark search is advised before publish.
- **DCO** `git commit -s` on every commit; bypass tests must fail with their control removed.
