---
description: "Task list — Gate Ceremony Extraction (attesto.mount)"
---

# Tasks: Gate Ceremony Extraction (attesto.mount)

**Input**: Design documents from `/specs/003-gate-ceremony-extraction/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D8), data-model.md, contracts/attesto-mount.api.md (CT1–CT12)

**Tests**: REQUIRED. The constitution (Security Requirements) + spec FR-014 mandate bypass tests — a test that
still passes with its control removed is rejected.

**Branch**: `feat/attesto-gate-v0.1` (brownfield — demo consumes `attesto.mount()`; full suite 253/1-skip + live
deploy green at every commit; DCO `git commit -s` on every commit).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete-task dependency)
- Paths are concrete: the ceremony lands in `packages/attesto-gate/src/ceremony/`.

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Create the ceremony module skeleton in `packages/attesto-gate/src/ceremony/` (`mount.ts` entry + `passkey/`, `dc-payment/`, `credential-gate/` subdirs); add the files to `packages/attesto-gate/tsconfig.json` `include` and ensure `npm run build:packages` compiles them.
- [ ] T002 [P] Add the WebAuthn + test deps to `packages/attesto-gate/package.json` (`@simplewebauthn/server`, `@simplewebauthn/browser`; `supertest` dev) and confirm `build:packages` (vite + tsc) stays green with the new files present.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the shared seams + helpers EVERY rail depends on. No user story can land until these exist.

- [ ] T003 Define the injected-seam contract in `packages/attesto-gate/src/ceremony/mount.ts`: read `verificationStore`, `orderStore`, `completion`, `signingKey`, `origin`, `catalog`, optional `settlement` from `app.locals.attesto`/options; **fail fast** with a clear error when a required seam is missing (FR-009, CT2).
- [ ] T004 [P] Extract the stateless sealed-HMAC nonce into `packages/attesto-gate/src/ceremony/challengeToken.ts` (issue/verify; signed by the injected stable `signingKey`; single-use within expiry) (data-model: Challenge token; D6).
- [ ] T005 [P] Extract `deriveOrigin(req)` (from `x-forwarded-proto/host`, else Host → `{rpID, origin}`) into `packages/attesto-gate/src/ceremony/origin.ts` (FR-007).
- [ ] T006 Extract the shared completion seam into `packages/attesto-gate/src/ceremony/completion.ts` (`completeOrder`: idempotent record + re-price from injected catalog + optional settlement + clear cart & per-order verification) (FR-008, FR-013, CT8).
- [ ] T007 Extract the AP2 mandate + the four deterministic gates (amount integrity, authorization present, user verification asserted, subject/credential binding) into `packages/attesto-gate/src/ceremony/mandate.ts`; mandate carries `trust_level: "presence-only-demo"` (dev-signed, FR-011) (data-model: AP2 mandate, four gates).
- [ ] T008 Implement route registration in `packages/attesto-gate/src/ceremony/mount.ts` and wire it from `Attesto.mount(app)` in `packages/attesto-gate/src/client.ts` so all three rails' routes attach to the host app (CT1).

**Checkpoint**: `mount(app)` wires up + fails fast; `npm run build:packages` green. No rail behavior yet.

---

## Phase 3: User Story 1 — Age + membership run through the gate (Priority: P1) 🎯 MVP

**Goal**: an age-restricted order cannot complete until age is proven through the gate; a member sees the discount
applied. The GDC hero. **Independent test**: the bypass tests in T009 + the manual ceremony for the credential rail.

### Tests (write first — must fail before impl, and fail if the control is later removed)

- [ ] T009 [P] [US1] Bypass/contract tests in `packages/attesto-gate/src/ceremony/credential-gate/credential-gate.test.ts` (supertest): CT4 (verify succeeds only on `age_over_21 === true`; an `age_over_18` proof is REFUSED for a 21+ gate); CT9 (an unverified age-restricted order is refused on the verify handler, `place-order`, AND the MCP checkout/completion tool); CT10 (verifying order A does not unlock order B); CT5 (a verified membership applies the discount exactly once and line sum == total); CT11 (page/receipt state `presence-only-demo`).

### Implementation

- [ ] T010 [US1] Extract the credential-gate rail (OpenID4VP `dcql`/`request`/`verify`/`page`/`routes` split) into `packages/attesto-gate/src/ceremony/credential-gate/` for AGE and MEMBERSHIP.
- [ ] T011 [US1] Age verify writes a positive per-order claim to the injected `verificationStore` with the threshold matching the order's `minimumAge` (explicit `age_over_21 === true`; reject lower thresholds) (FR-002, FR-006).
- [ ] T012 [US1] Membership verify marks the order; the GATE owns the `membership.discount` effect and the storefront's `priceCart` re-derives the discounted total once — line sum == total == any payment amount on every path (FR-005, CT5).
- [ ] T013 [US1] Enforce age/membership server-side on EVERY completion path — the credential `verify` handler, `place-order`, and the MCP checkout/completion tool — re-deriving restriction from the order lines, never the token (FR-003, FR-004, CT9).
- [ ] T014 [US1] Demo consumes `attesto.mount()` for this rail: the demo checkout page links to the credential routes; remove the demo's storefront-local age stub (supersedes `feat/storefront-age-enforcement`; keep the `place-order` 403, move verification ownership to the gate).
- [ ] T015 [US1] Verify US1: `npm run build` green; `npx vitest run packages/attesto-gate packages/attesto-storefront` green incl. T009 bypass tests; full `npm test` green (253/1-skip parity, CT12).

**Checkpoint**: age blocks + membership discounts through the gate; MVP demoable independently.

---

## Phase 4: User Story 2 — Passkey payment (same + cross-device) (Priority: P2)

**Goal**: payment authorizes via WebAuthn passkey (Touch ID/Windows Hello + caBLE), four gates run, optional
Hedera-testnet settlement. **Independent test**: T016.

- [ ] T016 [P] [US2] Bypass tests in `packages/attesto-gate/src/ceremony/passkey/passkey.test.ts` (supertest + recorded WebAuthn fixture): CT6 (four deterministic gates run; replayed/expired challenge rejected; mismatched origin/RP-ID rejected); CT7 (tampered amount refused by the amount-integrity gate, re-priced from catalog).
- [ ] T017 [US2] Extract the passkey rail into `packages/attesto-gate/src/ceremony/passkey/` (`verify.ts`, `routes.ts`, `page.ts`) + serve `@simplewebauthn/browser` ESM same-origin at `/attesto/lib/sw/*`.
- [ ] T018 [US2] Wire the four gates (T007) + `completeOrder` (T006); same-device and cross-device (`?xdev=1` caBLE) toggle bound to the derived origin/RP-ID (FR-007, CT6).
- [ ] T019 [US2] Demo consumes the passkey route via `mount()`; optional Hedera/x402 settlement through the injected `settlement` seam (demo-mode; failed settlement ⇒ no paid record, FR-013).
- [ ] T020 [US2] Verify US2: `npm run build` + `npx vitest run packages/attesto-gate` (incl. T016) + full `npm test` green.

**Checkpoint**: end-to-end purchase — age + membership + passkey payment — through the gate.

---

## Phase 5: User Story 3 — Digital-Credentials payment rail (Priority: P3)

**Goal**: amount-bound DC API / OpenID4VP payment completing through the SHARED `completeOrder`. **Independent test**: T021.

- [ ] T021 [P] [US3] Test in `packages/attesto-gate/src/ceremony/dc-payment/dc-payment.test.ts`: CT8 (dc-payment records through the same `completeOrder` seam as passkey — idempotent, re-priced, cart + verification cleared; amount bound).
- [ ] T022 [US3] Extract the dc-payment rail (`dcql`/`request`/`verify`/`page`/`routes`) into `packages/attesto-gate/src/ceremony/dc-payment/`, completing via the shared `completeOrder` (no second completion path) (FR-008, CT8).
- [ ] T023 [US3] Demo consumes the dc-payment route via `mount()`.
- [ ] T024 [US3] Verify US3: `npm run build` + `npx vitest run packages/attesto-gate` (incl. T021) + full `npm test` green.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T025 [P] Collapse the demo's `payment-gate/` modules to thin re-export shims pointing at `packages/attesto-gate/src/ceremony/` so no import path dies (actual file deletion is the steered follow-up — `rm`/`git rm` is sandbox-blocked); confirm no logic is duplicated (no drift).
- [ ] T026 [P] Audit the presence-only honesty surfaces (ceremony page + receipt) — every surface states `trust_level: "presence-only-demo"`, none presents the gate as a real safety control (FR-011, SC-006, CT11).
- [ ] T027 Serverless verify: a stable injected `signingKey` + shared `verificationStore`/`orderStore` survive an instance split (options→verify and place-order→poll on different instances); smoke on a Vercel preview (re-point the `attesto-storefront.vercel.app` alias) (D6, CT2).
- [ ] T028 [P] Update the package README + `specs/003-…/quickstart.md` references to the live `mount()` pattern; confirm the adopter path is ≤ 10 lines (SC-005); reconcile the 002 quickstart's `mount()` comment (no longer "feature 003").
- [ ] T029 Final gate: full `npm test` green (253/1-skip baseline, CT12) + `npm run build` deploy-safe; every commit DCO-signed; every bypass test verified to FAIL with its control removed (FR-014).

---

## Dependencies & Execution Order

- **Phase 1 (Setup) → Phase 2 (Foundational) → US1 (P1) → US2 (P2) → US3 (P3) → Polish.**
- **Foundational blocks everything**: the rails all depend on `mount.ts` (T003/T008), `challengeToken` (T004), `origin` (T005), `completion` (T006), `mandate` (T007).
- **US1 is the MVP** — independently testable and the GDC hero; ship it first.
- **US2 and US3 are independent of each other** once Foundational is done (different `ceremony/` subdirs), but both register routes in `mount.ts` — coordinate that one file.
- **Within a story**: tests (T009/T016/T021) before implementation.

## Parallel Opportunities

- Phase 2: **T004 + T005** in parallel (challengeToken / origin — different files).
- Test tasks **T009, T016, T021** are each `[P]` (separate files) and can be authored ahead of their rail.
- After Foundational, **US2 and US3 rails can be built in parallel** (separate subdirs) by different agents/worktrees, merging the `mount.ts` route registration carefully.

## Implementation Strategy (MVP first)

1. **Setup + Foundational** (T001–T008) — the seams + shared helpers.
2. **US1** (T009–T015) — age + membership through the gate = the demoable MVP for GDC. **Stop here for validation** in a widget-capable host before US2/US3.
3. **US2** (passkey) then **US3** (dc-payment).
4. **Polish** (T025–T029) — shims, honesty audit, serverless smoke, parity gate.

Given the ~28-file extraction across 3 rails, the Foundational + per-rail extraction is a natural **Workflow fan-out** (one agent per rail in an isolated worktree after Foundational lands), each keeping the full suite green and pushing its branch.
