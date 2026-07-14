# Research: Generic credential rail

Phase 0 output. Records the design decisions that resolve the plan's open questions, each with rationale and
the alternatives considered. No `NEEDS CLARIFICATION` remained after the pre-spec brainstorm; this file
captures *why* the chosen shape is the one that satisfies the constitution and the six security invariants.

## D1 — How the mounted rail obtains a custom credential's `request`/`verify`

**Decision.** An in-process **credential registry** — `Map<string, Credential>` held on the `CredentAgent`
instance — populated **synchronously** inside `requirements()` as it iterates the policy
(`for (const step of policy) registry.set(step.credential.id, step.credential)`). The registry is injected
into the ceremony context by `mount()`, so both the rail and `completeOrder` can look a credential up by id.

**Rationale.**
- `verify`/`appliesTo`/`request` are functions/closures; they cannot be serialized to the URL or a store
  (Principle VI — functions never cross the code→data boundary). They must be reached as **live code**, which
  a per-instance Map provides.
- Populating in `requirements()` keeps `requirements()` **synchronous** (a Map write is sync), so the public
  API is unchanged (Principle I). The registry holds only code; no async store write is introduced.
- "No registration step" (Principle V) is preserved *literally*: the developer still passes the credential by
  object in the policy; registration is an invisible internal side effect of resolving that policy.

**Alternatives considered.**
- **Explicit config-time set** — `new CredentAgent({ credentials: [...] })`. More deterministic (registry is
  full before any order), but it adds public API and softens "no registration step." Kept in reserve as the
  multi-instance hardening (see D4).
- **Seam-published set** — the storefront's `gate()` wrapper publishes the credential set on
  `app.locals.credentagent`. No new developer API, but couples credential availability to the storefront
  wrapper rather than the gate instance. Rejected for weaker cohesion.
- **Persist the resolved credential per order** — impossible for the `verify` function; it would still need a
  code-side lookup, collapsing back into a registry.

## D2 — Building a custom credential's wallet request from its own definition

**Decision.** For a custom id, `dcql.ts` returns the credential's own `request` (its `DcqlQuery`) directly
instead of switching on `"age" | "membership"`. `doc-spec.ts` derives the ISO 18013-5 single-doctype request
(the iOS `org-iso-mdoc` path) from that same `DcqlQuery` — doctype from `meta.doctype_value`, elements from
the claim `path` leaves — so both wallet protocols are served from one source of truth (as they are today for
the built-ins). The built-in `age`/`membership` kinds keep their existing order-parameterized builders
(age's threshold and membership's percent are order-derived and must not regress).

**Rationale.** `defineCredential`'s `request` is already a full `DcqlQuery` (`dcql({ docType, claims })`). The
existing `request.ts` signer, reader-cert mint, ephemeral ECDH key, and sealed nonce are credential-agnostic —
they take a `DcqlQuery` and an origin. So the generalization is "read the query off the credential" rather than
new crypto (origin/replay binding, invariant 6, is untouched).

**Alternatives considered.** A parallel generic request builder duplicating `request.ts` — rejected;
`request.ts` already parameterizes on the DCQL, so only the `dcql.ts`/`doc-spec.ts` source of the query changes.

## D3 — Running a custom credential's `verify` and recording the result

**Decision.** For a custom id, `verify.ts` evaluates the disclosed claims with the credential's own
`verify(claims)` (which must assert an explicit positive, e.g. `license_active === true` — invariant 5), across
both the instant-demo claims path and the real OpenID4VP/mdoc presentation path (both already flatten disclosed
claims into a `Record<string, unknown>` before the policy check). On success the rail's `recordVerified` writes
`verifiedGates[id] = true` into the per-order `VerificationRecord` (keyed by order id — invariant 4). Built-in
age writes `ageVerified`, membership writes `loyalty` — unchanged.

**Rationale.** The claim-flattening and the two verification entry points already exist and already run a
single policy function; the change is *which* function runs (the credential's own `verify` vs the hardcoded
built-in). Keeping age/membership on their dedicated records means existing bypass tests and the loyalty
reconciliation stay green.

## D4 — Enforcing custom gates at completion (the security core)

**Decision.** After re-pricing, `completeOrder` **sweeps the injected registry** and, for every credential that
is (a) not a reserved built-in id (`age`/`membership`/`payment`), (b) `effect.kind === "gate"`, and (c)
applicable to the **re-priced** order (`appliesTo(repriced) ?? true`), requires `verifiedGates[id] === true` in
the order's verification record. Any missing one refuses with `reason: "gate"`, writing no completed record.
Age/loyalty/payment enforcement is unchanged.

**Rationale.**
- Enforcement is in the shared `completeOrder` that every rail calls (invariant 1) — not the rendered page.
- Applicability is **re-derived at completion from the re-priced order** (invariant 2) — the token is never
  trusted, exactly as age's `minimumAge` re-derivation works today.
- `gate()` *is* the hard-block semantic (Principle V), so "enforce every applicable `gate()` credential"
  faithfully captures the developer's intent without threading the per-order `required` flag into the gate
  package. `optional(gate())` is contradictory; `optional` remains meaningful for `discount()`/`authorize()`.

**Alternatives considered.**
- **Record the per-order required-gate set in `requirements()`** and check it at completion. More literally
  faithful to `required` vs `optional`, but a store write makes `requirements()` **async** — a breaking public
  API change (Principle I). Rejected. (If a future feature needs `optional(gate())`, revisit with the
  config-time set from D1 so the required set can be captured without async.)
- **Enforce via the rail's `input.gates` (`GateOutcome[]`)** already passed to `completeOrder`. Rejected as the
  sole control: those are the gates the *calling rail* knows about; a rail could omit a gate, so completion must
  independently re-derive the requirement (defense in depth), which the registry sweep does.

**Known limitation (tracked, honest).** Register-on-resolve means an instance enforces a custom gate only after
it has resolved a policy containing it. Single-server reference deploys always resolve at link-mint before any
completion, so they are unaffected. Multi-instance deploys must warm the registry at startup (resolve the policy
once) or adopt the D1 config-time set. This mirrors the project's standing model: **definitions are code on
every instance; only state is shared.** Documented in the pack docs and `ARCHITECTURE.md`.

## D5 — Honesty (`trust_level`) for the pack

**Decision.** Every custom-credential surface (signed request, ceremony page, verify result) carries
`trust_level: "presence-only-demo"`, identical to the built-in credential rail. The professional-license pack
docs state plainly that it enforces disclosure + nonce binding, **not** issuer/device trust, and must not be
presented as a real safety control until issuer-verified trust (#14) lands.

**Rationale.** The generalization reuses the exact same wire crypto (real) and the exact same missing trust
anchor (self-signed reader cert) as age/membership. Nothing about going generic changes the trust story
(Principle VII), so the honesty fence is inherited unchanged — and must be stated per pack so a
"professional-license" card is never mistaken for an authoritative check.

## D6 — Test strategy (acceptance bar)

**Decision.** Acceptance = the **instant-demo claims path + bypass tests**, each of which must go **red** when
its control is removed:
1. POST an order with an applicable required custom gate, unverified, straight to completion → refused
   (`reason: "gate"`), no record. Red-check: remove the sweep → it wrongly completes.
2. Verify the custom claim (`license_active === true`) for that order → completion succeeds.
3. A wrong/negative claim (`license_active === false` / absent) → not recorded → completion still refused.
4. Per-order scoping: verify for order A, attempt completion for order B (same credential) → B refused.
5. No-regression: the full existing suite (age threshold, loyalty reconciliation, amount binding) stays green.

**Rationale.** Matches the constitution's "a test that still passes with the control removed is not useful" and
the project's existing bypass-test discipline. Real-wallet e2e is out of scope (no test-issuer for a new
doctype yet) and is filed as a separate dependency.
