---
description: "Task list for Generic credential rail (issue #19)"
---

# Tasks: Generic credential rail — make `defineCredential` complete on the phone

**Input**: Design documents in `specs/007-generic-credential-rail/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/credential-rail-contract.md](./contracts/credential-rail-contract.md),
[quickstart.md](./quickstart.md)

**Tests**: INCLUDED and required. Security-bypass tests are a hard requirement (spec SC-003; constitution
"a test that still passes with the control removed is not useful"). Each bypass test MUST be verified **red**
when its control is deleted. Every commit MUST be DCO-signed (`git commit -s`).

**Organization**: by user story. Reserved built-in ids (`age`/`membership`/`payment`) stay on their existing
code paths throughout — no regression. Per the F1 analysis resolution, `gate()` is the hard-block effect and is
enforced whenever it **applies**, independent of the `required`/`optional` flag.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no incomplete-task dependency)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)

## Path Conventions

Library monorepo. Security-bearing code lives in `packages/credentagent-gate/src/`; the pack/example and docs
live in `examples/`, `ARCHITECTURE.md`, and the package READMEs. Tests are colocated `*.test.ts` files
(vitest), matching the existing suite layout.

---

## Phase 1: Setup

**Purpose**: baseline + shared test fixture.

- [x] T001 Confirm baseline green on branch `007-generic-credential-rail`: `npm run build` and `npm run test` (gate + storefront) both pass before any change (records the pre-change red/green line).
- [x] T002 [P] Add a shared test fixture — a `professional_license` `defineCredential` gate (`gate()`, `appliesTo` a `Licensed`-category line, `verify: c => c.license_active === true`) plus an applicable priced order — in `packages/credentagent-gate/src/ceremony/credential-gate/__fixtures__/customCredential.ts`, reused by the US1/US2 suites.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the credential registry + type/seam plumbing that BOTH US1 (rail) and US2 (completion) depend on.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [x] T003 [P] Extend `VerificationRecord` with `verifiedGates?: Record<string, true>` in `packages/credentagent-gate/src/types.ts` (per-order custom-gate verification map; invariant 4).
- [x] T004 [P] Extend `CompletionResult.reason` union with `"gate"` in `packages/credentagent-gate/src/ceremony/types.ts`.
- [x] T005 [P] Add exported `RESERVED_CREDENTIAL_IDS = new Set(["age","membership","payment"])` in `packages/credentagent-gate/src/credentials.ts` (single source the rail + completion both consult to exclude built-ins).
- [x] T006 [P] Add `credentialRegistry?: ReadonlyMap<string, Credential>` to `CompletionContext` in `packages/credentagent-gate/src/ceremony/completion.ts` (type only; the sweep logic is T022).
- [x] T007 Add `credentialRegistry` to `CeremonySeams` + `CeremonyContext` and thread it into each rail's ctx and the bound completion seam in `packages/credentagent-gate/src/ceremony/mount.ts` (depends on T006).
- [x] T008 Add the in-process registry to `CredentAgent` (`private registry = new Map<string, Credential>()`), populate it **synchronously** in `requirements()` (`for (const step of policy) this.registry.set(step.credential.id, step.credential)`), and pass `this.registry` as `credentialRegistry` in BOTH `mount()` paths (seams + zero-arg compose) in `packages/credentagent-gate/src/client.ts` (depends on T007).

**Checkpoint**: a custom credential resolved by `requirements()` is reachable by id from the rail and completion.

---

## Phase 3: User Story 1 — Custom credential completes on the phone, no new code path (Priority: P1) 🎯 MVP

**Goal**: the mounted ceremony builds a custom credential's request from its own DCQL and evaluates it with its
own `verify`, recording `verifiedGates[id]` — no new rail, no switch-case, no registration.

**Independent Test**: drive `GET …/credential/request?cred=professional_license` and `POST …/credential/verify`
(instant-demo claims) for the fixture credential; assert the request carries its own doctype/claims and a
positive claim records the gate while a negative one does not.

### Tests for User Story 1 (write first — must FAIL before implementation) ⚠️

- [x] T009 [P] [US1] Test: the signed request for a registered custom cred embeds its **own** DCQL doctype + claim leaves (not an age/membership shape), the `org-iso-mdoc` request carries the derived single doctype/elements, **and the request reports `trust_level: "presence-only-demo"`** (F4/FR-010) — in `packages/credentagent-gate/src/ceremony/credential-gate/generic-credential.test.ts`.
- [x] T010 [P] [US1] Test: `POST …/verify` with `{ cred: "professional_license", claims: { license_active: true } }` records `verifiedGates.professional_license = true` for the order **and the result reports `trust_level: "presence-only-demo"`** (F4/FR-010); `{ license_active: false }` (or absent) records nothing — same file.
- [x] T011 [P] [US1] Test: an unregistered/unknown `cred` id returns `404` on the page + request routes and is refused on verify (FR-013) — same file.

### Implementation for User Story 1

- [x] T012 [P] [US1] Generalize `dcql.ts`: for a non-reserved id, return the resolved credential's own `request` `DcqlQuery` (keep the age/membership order-parameterized builders for reserved ids) in `packages/credentagent-gate/src/ceremony/credential-gate/dcql.ts`.
- [x] T013 [P] [US1] Generalize `doc-spec.ts`: derive the `org-iso-mdoc` `MdocDocSpec` (doctype from `meta.doctype_value`, elements from the claim `path` leaves) from a custom credential's `request` DCQL in `packages/credentagent-gate/src/ceremony/credential-gate/doc-spec.ts`.
- [x] T014 [P] [US1] Generalize `verify.ts`: add a custom path that runs the credential's own `verify(claims)` (explicit positive; invariant 5) across BOTH the instant-demo and the OpenID4VP/mdoc presentation flows, returning a `CredGateResult` labeled from the credential `ui` and carrying `trust_level: "presence-only-demo"` — in `packages/credentagent-gate/src/ceremony/credential-gate/verify.ts`.
- [x] T015 [US1] Generalize `routes.ts`: replace `parseKind` with a resolver that accepts a built-in kind OR a registered custom id (looked up via `ctx.credentialRegistry`, excluding `RESERVED_CREDENTIAL_IDS` from the generic branch); build request via T012/T013, verify via T014, and have `recordVerified` write `verifiedGates[id] = true` for custom creds; unknown id → `404` — in `packages/credentagent-gate/src/ceremony/credential-gate/routes.ts` (depends on T012–T014).
- [x] T016 [US1] Confirm built-ins are untouched: `age`/`membership` still route through their existing order-parameterized path (threshold/percent preserved) and skip the generic branch; run the existing credential-gate suite green.

**Checkpoint**: a custom credential can be requested + proven on the mounted ceremony (US1 independently testable).

---

## Phase 4: User Story 2 — Custom gate enforced at completion (Priority: P1) 🎯 MVP

**Goal**: `completeOrder` refuses any applicable custom `gate()` credential not in the order's `verifiedGates`,
on every payment path, re-deriving applicability from the re-priced order — independent of `required`/`optional`.

**Independent Test**: POST an unverified applicable order straight to the completion path → refused
(`reason: "gate"`), no record; seed `verifiedGates` → completes; a gate verified for order A does not complete
order B.

### Tests for User Story 2 (write first — must FAIL before implementation) ⚠️

- [x] T017 [P] [US2] **Bypass test**: an order with an applicable custom `gate()`, unverified, through `completeOrder` → `{ completed: false, reason: "gate" }` and no completed record. Assert it wrongly completes when the sweep is removed (red-check) — in `packages/credentagent-gate/src/ceremony/completion.test.ts`.
- [x] T018 [P] [US2] Test: with `verifiedGates[id] = true` seeded for the order, `completeOrder` completes — same file.
- [x] T019 [P] [US2] Test: per-order scoping — a gate verified for order A does not let order B (same credential, applicable) complete (SC-005) — same file.
- [x] T020 [P] [US2] Test: a non-applicable custom gate (`appliesTo` false on the re-priced order) does not block; a custom `gate()` declared `optional(...)` is **still** enforced (F1); and a reserved built-in (age) is enforced only by its existing path (not double-counted / not swept) — same file.
- [x] T021 [P] [US2] Test (F3/FR-009): a custom `gate()` composed alongside `payment` (+ a `membership` discount) does not disturb amount binding — line sum = order total = bound payment amount reconcile exactly, and the custom gate's presence changes no amount — same file.

### Implementation for User Story 2

- [x] T022 [US2] Generalize `completeOrder`: after re-pricing, sweep `ctx.credentialRegistry` for credentials that are non-reserved, `effect.kind === "gate"`, and `appliesTo(repriced) ?? true`; require `verifiedGates[id] === true` for each; on any miss return `{ completed: false, reason: "gate" }` writing no record. Leave age/loyalty/payment/idempotency/cart-mandate/reconciliation checks unchanged — in `packages/credentagent-gate/src/ceremony/completion.ts` (depends on T006, T008).

### Wiring proof for User Story 2

- [x] T023 [US2] **Mount-level integration test (F2)**: exercise the FULL mounted path — `credentagent.mount(app)` → the rail's `/credentagent/credential/verify` → `completeOrder` — for a custom `gate()`, **without manually seeding `ctx.credentialRegistry`**, asserting refuse-before / enforce-after. This is the only test that catches a broken `mount()` registry injection (T007/T008); the unit bypass test (T017) seeds the registry directly and would pass even if injection were removed — in `packages/credentagent-gate/src/ceremony/mount.test.ts` (depends on T008, T015, T022).

**Checkpoint**: US1 + US2 together = the safe MVP (custom credential provable AND enforced, wiring proven).

---

## Phase 5: User Story 3 — Professional-license pack proves it + docs made true (Priority: P2)

**Goal**: a runnable pack + corrected docs demonstrate a custom `gate()` completing on the phone with no new
code path; `ARCHITECTURE.md` and the honest-limit footers reflect the now-true behavior.

**Independent Test**: run the example and walk quickstart.md steps 1–6; confirm the license card surfaces only
for the licensed line, the order refuses until proven, and every surface reports `presence-only-demo`.

- [x] T024 [P] [US3] Add the runnable pack example `examples/professional-license.mjs` (mirror `examples/custom-credential.mjs`: a catalog with a `Licensed`-category line, `professionalLicense = defineCredential({ id: "professional_license", request: dcql({ docType: "org.example.license.1", claims: ["license_active"] }), verify: c => c.license_active === true, effect: gate(), appliesTo: order => order.lines.some(l => l.category === "Licensed"), ui: {...} })`, composed on the policy array; presence-only-demo).
- [x] T025 [P] [US3] Correct the "honest limit" footer in `examples/custom-credential.mjs` (currently states a custom credential's request/verify are NOT executed by the ceremony — now false): update to describe the now-true behavior while keeping the `presence-only-demo` fence.
- [x] T026 [US3] Update `ARCHITECTURE.md` "adding a new gate or credential": "A new credential — no new code path" is now literally true; add the multi-instance registry warm-up note (research D4) and the `gate()`-always-blocks semantic (F1).
- [x] T027 [P] [US3] Add the professional-license example to `examples/README.md`.

**Checkpoint**: all three stories functional; the docs match observable behavior (SC-006).

---

## Phase 6: Polish & Cross-Cutting

- [x] T028 [P] Sync the two package READMEs (`packages/credentagent-gate/README.md`, `packages/credentagent-storefront/README.md`) with the now-true custom-credential behavior, keeping the `trust_level` fencing honest (CLAUDE.md: READMEs are the published docs).
- [x] T029 Run the full suites + build: `npm run test` (gate + storefront) and `npm run build` green; verify EACH new bypass test (T017, T010-negative, T019, T023) goes red when its control is removed, then restore.
- [x] T030 Run the quickstart.md manual walk against `examples/professional-license.mjs` (steps 1–6).
- [x] T031 Commit on `007-generic-credential-rail` with DCO sign-off (`git commit -s`); confirm every commit carries `Signed-off-by:`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no dependencies.
- **Foundational (P2)**: after Setup — **blocks US1 and US2**. Within it: T003/T004/T005/T006 are [P]; T007 depends on T006; T008 depends on T007.
- **US1 (P3)** and **US2 (P4)**: both after Foundational. US2's core impl (T022) depends only on Foundational, so US1 and US2 unit work can proceed in parallel; the US2 wiring proof (T023) depends on US1's `recordVerified` (T015) + T008 + T022.
- **US3 (P5)**: after US1 + US2 (the example only works end-to-end once both land).
- **Polish (P6)**: after all desired stories.

### Within a story

- Tests (T009–T011, T017–T021) written first and FAIL before implementation.
- US1: T012/T013/T014 [P] → T015 → T016.
- US2: unit tests [P] → T022 → T023 (integration wiring proof).

### Parallel opportunities

- Foundational: T003, T004, T005, T006 together.
- US1 tests: T009, T010, T011 together; US1 impl: T012, T013, T014 together (then T015).
- US2 tests: T017, T018, T019, T020, T021 together (T023 is NOT [P] — it depends on impl).
- US3: T024, T025, T027 together (T026 after, as it references the example).

## Parallel Example: Foundational

```bash
# After T001/T002, launch the independent type/const edits together:
Task: "Extend VerificationRecord with verifiedGates in packages/credentagent-gate/src/types.ts"          # T003
Task: "Extend CompletionResult.reason with 'gate' in packages/credentagent-gate/src/ceremony/types.ts"    # T004
Task: "Add RESERVED_CREDENTIAL_IDS in packages/credentagent-gate/src/credentials.ts"                      # T005
Task: "Add credentialRegistry to CompletionContext in packages/credentagent-gate/src/ceremony/completion.ts" # T006
```

## Implementation Strategy

### MVP (the safe minimum) = Foundational + US1 + US2

Both P1 stories ship together: US1 without US2 would surface a custom gate that isn't enforced (an invariant-1
hole), and US2 without US1 has nothing writing `verifiedGates`. Complete Setup → Foundational → US1 → US2 →
**STOP and validate** (quickstart section A bypass suite green + red-when-removed, including the T023 wiring proof).

### Incremental delivery

1. Foundational → registry reachable.
2. US1 + US2 → custom credential provable AND enforced, wiring proven (MVP; the core of issue #19).
3. US3 → the professional-license pack + corrected docs make the capability copy-pasteable and the docs true.
4. Polish → READMEs, full green, quickstart walk, DCO.

## Notes

- Issue #19's stated process is a **spec-only PR → Diego review → impl**. The spec + plan artifacts in this
  directory are that spec-only deliverable; T001–T031 are the follow-on implementation once the spec is
  approved. Sequence per the maintainer's preference.
- **F1 resolution (baked in):** `gate()` is the hard-block effect and is enforced whenever it applies,
  independent of `required`/`optional`; `optional` is meaningful only for `discount()`/`authorize()`.
- Out of scope (do not add tasks): SD-JWT VC, additional packs, real-wallet e2e / dev test-issuer,
  issuer-verified trust (#14).
- Every bypass test must fail with its control removed (T029 verifies this explicitly, incl. the T023 wiring proof).
