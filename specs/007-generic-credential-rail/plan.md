# Implementation Plan: Generic credential rail — make `defineCredential` complete on the phone

**Branch**: `007-generic-credential-rail` | **Date**: 2026-07-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-generic-credential-rail/spec.md`

## Summary

Make the mounted credential ceremony serve **any** credential in the resolved policy from that credential's
own definition (retiring the closed `CredentialKind = "age" | "membership"` union), and make the shared
completion path enforce **any** applicable `gate()`-effect credential — not only age. The mechanism is an
in-process **credential registry** (a `Map<string, Credential>` on the `CredentAgent` instance) populated
synchronously as `requirements()` resolves policies (register-on-resolve; no new public API, so Principle V's
"no registration step" holds literally). The registry is injected into the ceremony context at `mount()`,
reaching both the rail (to build a custom credential's request from its own DCQL and run its own `verify`) and
the completion path (to re-derive which custom gates apply against the **re-priced** order). One worked pack —
a professional-license `gate()` — proves the path end-to-end and makes `ARCHITECTURE.md`'s "a new credential,
no new code path" claim true.

## Technical Context

**Language/Version**: TypeScript (ESM), Node ≥ 18 — `@openmobilehub/credentagent-gate` workspace.

**Primary Dependencies**: existing only — `jose` (OpenID4VP JWE/ECDH, JWT signing), the in-repo `mdoc/`
helpers (ISO 18013-5 parse, reader cert, encryption key, sealed reader context). **No new dependencies.**

**Storage**: per-order `VerificationStore` (default in-memory `MemoryVerificationStore`; injectable — e.g.
Redis). The credential registry is **in-process only** (holds functions), never persisted, never on the wire.

**Testing**: `vitest` per workspace (`npm run test` in `packages/credentagent-gate`). Security-bypass tests
that go red when their control is removed.

**Target Platform**: Node server; the gate mounts `/credentagent/*` rails onto an Express-shaped host app.

**Project Type**: Library (npm workspace monorepo). The gate is the security surface; the storefront is a
reference consumer.

**Performance Goals**: N/A — the ceremony is user-interactive, not throughput-bound. No new hot paths.

**Constraints**: the six Security Invariants + constitution Principles I–VII; `trust_level`
`presence-only-demo` on every custom-credential surface; DCO sign-off; **no new public registration API**;
**built-in age/membership/payment behavior MUST NOT regress**; mdoc/OpenID4VP only (SD-JWT out of scope).

**Scale/Scope**: small, well-bounded — ~6 source files generalized, 1 type extended, 1 registry added, 1 new
pack + example, 1 doc corrected. No architectural expansion.

## Constitution Check

*GATE: evaluated against Principles I–VII + Security Requirements. Re-checked after design (below).*

| Article | Gate | Verdict |
| :-- | :-- | :-- |
| **I. Stripe-grade, MCP-idiomatic API** | No new public API; `requirements()` stays **sync**; `defineCredential` signature unchanged. | ✅ PASS |
| **II. Three contexts are sacred** | Registration happens in `requirements()` (Context 1 — mints/reports only, **no ceremony**); the rail runs in Context 2; poll unchanged. Registering a credential is a pure in-memory `Map.set`, not a ceremony. | ✅ PASS |
| **III. Consolidated checkout** | Unchanged — one handoff, one browser session. | ✅ PASS |
| **IV. One ordered, conditional policy array** | Custom gates already compose in the same array; payment still settles last; amount still server-derived. | ✅ PASS |
| **V. Extensible to any credential** | This feature **realizes** the principle end-to-end. Register-on-resolve is an internal detail; the developer still passes the credential by object with no registration step. | ✅ PASS (the point) |
| **VI. structuredContent is data, not policy** | The registry holds `request`/`verify`/`appliesTo` **in-process only**; the manifest stays functions-free JSON. `verify` runs server-side in the rail; it never crosses the wire. | ✅ PASS |
| **VII. Honesty in the types; prefer simplicity** | Every custom surface carries `trust_level: "presence-only-demo"`; the simplest mechanism (an in-process Map) was chosen over a new API or a persisted registry. | ✅ PASS |

**Security Requirements**

| Requirement | How this plan satisfies it |
| :-- | :-- |
| Enforce on every completion path | Enforcement lives in the shared `completeOrder` (completion.ts), which every rail calls — not in rendered HTML (FR-004). |
| Never trust the order token | Completion re-derives applicability by running each registry credential's `appliesTo` against the **re-priced** order (FR-005) — the same gold standard as age today. |
| Discounts reconcile with amount binding | The pack is `gate()` (no amount effect); existing reconciliation is untouched (FR-009). |
| Per-order state | `verifiedGates` is written keyed by order id in the per-order `VerificationStore` (FR-006). |
| Explicit positive claims | The generic verify runs the credential's own `verify(claims)`, which must assert an explicit positive (`license_active === true`); mere token presence fails (FR-007). |
| Origin & replay binding | The generic request path reuses the existing `request.ts` sealing (reader cert, ephemeral ECDH key, sealed nonce) — origin/RP-bound, replay-checked, no change. |

**One tracked risk (not a violation):** register-on-resolve populates the registry only on instances that have
resolved the policy at least once. In the single-server reference deployment (and the demo) this is always the
case before any completion. Multi-instance deployments must warm the registry (resolve the policy once at
startup) — see Complexity Tracking. This is consistent with the project's existing honesty that **credential
definitions are code deployed on every instance; only state is shared** via the store.

## Project Structure

### Documentation (this feature)

```text
specs/007-generic-credential-rail/
├── plan.md              # This file
├── spec.md              # Feature spec (/speckit-specify output)
├── research.md          # Phase 0 — key design decisions + alternatives
├── data-model.md        # Phase 1 — entities (registry, verifiedGates, refusal reason)
├── quickstart.md        # Phase 1 — runnable validation walk
├── contracts/
│   └── credential-rail-contract.md   # the generalized rail + completion contract
└── checklists/
    └── requirements.md  # spec quality checklist (already green)
```

### Source Code (repository root)

```text
packages/credentagent-gate/src/
├── client.ts                         # + in-process credential registry (Map) on CredentAgent;
│                                     #   requirements() registers each step's credential (sync);
│                                     #   mount() injects the registry into the ceremony context
├── types.ts                          # + VerificationRecord.verifiedGates?: Record<string, true>
├── manifest.ts                       # unchanged behavior (resolver already runs appliesTo, payment-last)
└── ceremony/
    ├── mount.ts                      # + credentialRegistry seam on CeremonySeams/CeremonyContext
    ├── types.ts                      # + CompletionResult.reason "gate"; registry on CompletionContext
    ├── completion.ts                 # + generic enforcement: sweep applicable gate()-effect custom
    │                                 #   credentials on the re-priced order; refuse unless verified
    └── credential-gate/
        ├── dcql.ts                   # generalize: for a custom id, use the credential's own request DCQL
        ├── doc-spec.ts               # generalize: derive the org-iso-mdoc doctype/elements from that DCQL
        ├── verify.ts                 # generalize: run the credential's own verify(claims) for a custom id
        └── routes.ts                 # parseKind → accept any registered id; recordVerified writes verifiedGates

packages/credentagent-storefront/src/  # reference consumer — catalog line + example wiring (no security logic)

examples/
└── professional-license.mjs          # runnable pack demo (mirrors custom-credential.mjs)

ARCHITECTURE.md                        # "adding a new gate or credential" corrected to match behavior
```

**Structure Decision**: Library monorepo. All security-bearing change lands in
`packages/credentagent-gate/src` (the single security surface — invariant 1 requires enforcement in the shared
`completeOrder`, not the host). The storefront and `examples/` change only to demonstrate the pack; they carry
no enforcement logic. Built-in `age`/`membership`/`payment` paths are left on their existing order-parameterized
code to keep the blast radius minimal and existing bypass tests green.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| :-- | :-- | :-- |
| In-process credential registry (register-on-resolve) | The rail + completion need a custom credential's `request`/`verify`/`appliesTo` (functions, un-serializable) by id; the mounted rail only sees `order`+`cred` off the URL today. | An explicit config-time credential set (`new CredentAgent({ credentials })`) is more deterministic but adds public API and dents Principle V's "no registration step"; deferred as the multi-instance hardening if needed. |
| Multi-instance registry warm-up (documented limitation) | Register-on-resolve means an instance must have resolved the policy once before it can enforce a custom gate at completion. | Persisting the registry can't carry functions (`verify`); a shared store can't hold code. Warming at startup (resolve once) or the config-time set (above) are the mitigations; single-server reference deploy is unaffected. |
| Enforce **every applicable `gate()`-effect** custom credential at completion (rather than plumbing the per-order `required` set) | `gate()` **is** the hard-block semantic (Principle V); an `optional(gate())` is contradictory. Sweeping the registry re-derives applicability at completion from the re-priced order (invariant-2 gold standard) with no async change. | Recording the per-order required-gate set would force `requirements()` to become async (store write) — a public-API break (Principle I). Rejected. `discount()`/`authorize()` opt-ins keep their existing meaning of `optional`. |
