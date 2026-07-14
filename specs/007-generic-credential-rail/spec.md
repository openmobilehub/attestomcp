# Feature Specification: Generic credential rail — make `defineCredential` complete on the phone

**Feature Branch**: `007-generic-credential-rail`

**Created**: 2026-07-08

**Status**: Draft

**Input**: Issue [#19](https://github.com/openmobilehub/credentagent/issues/19) — "Define Credential — credential library beyond age/membership/payment." Spec-only PR headed to review.

## Summary

The gate promises (constitution Principle V, `ARCHITECTURE.md`) that a developer can **gate any consequential
action with any credential** via `defineCredential({ id, request, verify, effect, ui })` — "a new credential,
no new code path." Today that promise is only half true: a custom credential fully **resolves** into the
`requires` manifest (the agent surfaces its card), but the **mounted phone ceremony** only knows the two
built-in kinds (age, membership). A custom credential's own request and verify are carried as data and never
executed on the phone, and a custom *required* gate is never enforced on the shared completion path — only
age is. So a custom gate today is surfaced but not provable and not enforced.

This feature closes that gap: the mounted credential ceremony serves **any** credential in the resolved
policy from that credential's own definition, and the shared completion path enforces **any** applicable
`gate()` credential — not only age. It ships one worked credential (a professional-license `gate()`) that proves
the end-to-end path and makes the `ARCHITECTURE.md` extension-points documentation literally true.

**In scope:** the runtime generalization (rail + completion enforcement, mdoc/OpenID4VP) and one curated
pack. **Out of scope (separate follow-ups):** SD-JWT VC format support, the broader pack catalog
(military / passport / healthcare / residency / education), and real-wallet end-to-end testing / a dev
test-issuer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A custom credential completes on the phone with no new code path (Priority: P1)

An SDK integrator defines a custom credential entirely by object — `defineCredential({ id, request, verify,
effect, ui })` — and drops it into the same ordered policy array as the built-ins. When the agent mints a
checkout link and the buyer opens the mounted ceremony, the custom credential's card can be **proven**: the
wallet request is built from that credential's own `request` definition, and the presented claims are checked
by that credential's own `verify` logic — with no new rail, no new switch case, and no registration step.

**Why this priority**: This is the core product promise (Principle V). Without it, custom credentials are a
resolver-only abstraction that dead-ends at the phone — the exact limitation the `prescription` worked
example documents today.

**Independent Test**: Define a custom credential, resolve a policy containing it, and drive the ceremony's
request + verify through the instant-demo claims path. The request reflects the credential's own doctype and
claims; a correct positive claim verifies; a wrong/negative claim does not. Delivers value on its own even
before the pack (US3) or completion enforcement (US2) land.

**Acceptance Scenarios**:

1. **Given** a policy containing a custom `defineCredential` gate that applies to the order, **When** the
   ceremony builds the wallet request for that credential, **Then** the request carries the credential's own
   doctype and requested claims (not a built-in age/membership shape).
2. **Given** the same custom gate, **When** the buyer presents the required positive claim, **Then** the
   ceremony records the gate as verified for that order.
3. **Given** the same custom gate, **When** the buyer presents a negative claim or the wrong claim, **Then**
   the ceremony does not record the gate as verified.
4. **Given** an integrator adds the custom credential, **When** they wire it, **Then** they pass it by object
   in the policy only — no separate registration call is required.

---

### User Story 2 - A custom gate is enforced at completion, not merely surfaced (Priority: P1)

An order that carries an applicable custom `gate()` credential can only complete once that gate has been
positively verified for that specific order. `gate()` is the hard-block effect (Principle IV), so it is
enforced whenever it **applies**, independent of whether the policy entry was written `required(...)` or
`optional(...)` — a hard block is not something a buyer can opt out of. (`required`/`optional` remain
meaningful for the non-blocking `discount()`/`authorize()` effects.) Enforcement happens on the shared
server-side completion path that every payment rail calls — not in rendered checkout HTML. Whether the gate
applies is re-derived server-side from the re-priced order, never trusted from the order token, and
verification state is scoped per order so one buyer's proof cannot unlock another's checkout.

**Why this priority**: This is the security core (Security Invariant 1 — enforce gates server-side on every
completion path; hiding a card is not enforcement). Today only age is enforced at completion; a custom
`gate()` that surfaces but is not checked there is a bypass. This story must ship with US1 for the
feature to be safe.

**Independent Test**: POST an order with an applicable custom `gate()` that has **not** been verified
directly to the completion path and assert it is refused, recording nothing; verify the gate, then assert the
same order completes. Assert that a gate verified for order A does not let order B (same credential) complete.
Every assertion must fail if its control is removed.

**Acceptance Scenarios**:

1. **Given** an order with an applicable custom `gate()` credential that has not been verified, **When**
   completion is attempted on any payment path, **Then** it is refused and no completed record is written.
2. **Given** the same order after the custom gate is verified for it, **When** completion is attempted,
   **Then** it completes.
3. **Given** an order token that claims the gate does not apply, **When** completion re-derives applicability
   from the re-priced order, **Then** the gate is still enforced (the token is not trusted).
4. **Given** a custom gate verified for order A, **When** completion is attempted for order B using the same
   credential, **Then** order B is refused until it carries its own verification.
5. **Given** an applicable custom `gate()`, **When** it is declared `optional(...)` rather than `required(...)`,
   **Then** it is **still** enforced at completion (a hard block is not opt-out); an unverified `optional`
   `discount()`/`authorize()` credential, by contrast, does **not** block completion.

---

### User Story 3 - The professional-license pack proves the path and makes the docs true (Priority: P2)

A professional-license credential ships as a runnable example and a documented recipe: a `gate()` credential
defined via `defineCredential`, conditional to the relevant catalog line, verifying an explicit positive
claim (`license_active === true`). Running the example demonstrates a custom gate completing on the phone with
no new code path, and `ARCHITECTURE.md`'s "A new credential — no new code path" section is updated to reflect
the now-true behavior.

**Why this priority**: The pack is the proof and the documentation of the generalization. It converts the
capability (US1 + US2) into something a developer can copy. It depends on US1/US2 but is not itself
load-bearing for safety.

**Independent Test**: Run the professional-license example; confirm the license card is surfaced only for the
relevant line, that the order refuses to complete until the license is proven, and that the example + docs
carry the presence-only-demo honesty fence. Confirm `ARCHITECTURE.md`'s extension-points text matches actual
behavior.

**Acceptance Scenarios**:

1. **Given** a catalog with a license-restricted line, **When** the agent prices a cart containing it,
   **Then** the professional-license gate is surfaced for that cart and absent for a cart without it.
2. **Given** the license-restricted order, **When** the buyer has not proven the license, **Then** the order
   does not complete; **When** they prove `license_active === true`, **Then** it completes.
3. **Given** any professional-license surface (request, page, verify result), **When** its trust is inspected,
   **Then** it reports `presence-only-demo` and is never presented as a real safety control.

---

### Edge Cases

- **Unregistered credential id in a link**: A ceremony request naming a credential id that is not in the
  resolved policy (e.g., a hand-crafted or stale link) is refused ("unknown credential"), the same way an
  unknown built-in kind is today.
- **Id collision with a reserved built-in** (`age` / `membership` / `payment`): built-in ids are reserved;
  the built-in order-parameterized path continues to own them (see Assumptions). A custom credential reusing a
  built-in id does not silently shadow the built-in.
- **Multiple applicable custom gates on one order**: every applicable custom `gate()` credential must be
  verified for the order before it can complete; one satisfied gate does not stand in for another.
- **Custom gate applicability flips on re-price**: applicability is computed from the re-priced order at
  completion, so a gate that applies to the true cart is enforced even if the token implies otherwise.
- **Replay / idempotency**: a replayed completion for an already-completed order echoes the recorded outcome
  and enforces/settles nothing twice, unchanged by this feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The mounted credential ceremony MUST be able to serve **any** credential present in the resolved
  policy, building the wallet request from that credential's own request definition — not only the built-in
  age and membership kinds.
- **FR-002**: The ceremony MUST evaluate a presented custom credential using that credential's own verification
  logic, executed server-side. The verification logic MUST NOT cross the wire to the agent or wallet
  (constitution Principle VI — functions never cross the code→data boundary).
- **FR-003**: Custom credentials MUST become available to the ceremony **without any registration step by the
  integrator** (Principle V). The integrator's only action is passing the credential by object in the policy.
- **FR-004**: An applicable `gate()`-effect credential — built-in **or** custom — MUST be enforced on the
  shared completion path that every payment rail calls. Because `gate()` is the hard-block effect, it is
  enforced whenever it applies, **independent of the `required`/`optional` policy flag** (`required`/`optional`
  govern only the non-blocking `discount()`/`authorize()` effects). An order with an applicable, unverified
  `gate()` credential MUST be refused, writing no completed record (Security Invariant 1).
- **FR-005**: Whether a custom gate applies to an order MUST be re-derived server-side from the **re-priced**
  order, never read from the order token (Security Invariant 2).
- **FR-006**: Verification state for a custom gate MUST be scoped per order/session; a gate verified for one
  order MUST NOT satisfy the same gate for a different order (Security Invariant 4).
- **FR-007**: A custom gate MUST be satisfied only by an explicit positive claim of the required value; mere
  presence of a token or an unrelated claim MUST NOT pass (Security Invariant 5).
- **FR-008**: The built-in age and membership behavior MUST NOT regress. Age's per-order threshold (an
  explicit positive over-age claim **at the order's threshold**, refusing a lower-threshold proof) and the
  membership discount MUST behave exactly as before, and all existing security bypass tests MUST stay green.
- **FR-009**: Amount-binding integrity MUST continue to hold across all payment paths in the presence of a
  custom credential; the generalization MUST NOT introduce any disagreement between the line sum, the order
  total, and the bound payment amount (Security Invariant 3).
- **FR-010**: Every custom-credential surface (wallet request, ceremony page, verify result) MUST carry
  `trust_level: "presence-only-demo"` until an issuer/device trust anchor lands (issue #14), and MUST NOT be
  presented as a real safety control (constitution Principle VII).
- **FR-011**: The feature MUST ship one runnable professional-license credential example and accompanying
  documentation demonstrating a custom `gate()` credential completing on the phone with no new code path.
- **FR-012**: `ARCHITECTURE.md`'s "adding a new gate or credential" section MUST accurately describe the
  now-true behavior (a new credential needs no new ceremony code path).
- **FR-013**: A ceremony request or completion that references a credential id absent from the resolved policy
  MUST be refused rather than served or silently passed.

### Key Entities *(include if feature involves data)*

- **Credential**: A thing to prove, defined by object — `{ id, request, verify, effect, appliesTo?, ui }`.
  Built-ins (age / membership / payment) are pre-defined credentials of the same shape; custom credentials
  carry a static request and verify conditioned only by `appliesTo`.
- **Credential registry (internal)**: An id→credential lookup the gate builds from resolved policies so the
  ceremony can serve a credential by id. It is an internal detail, not a public API, and holds code (request
  / verify), never wire state.
- **Verified-gates record (per order)**: Per-order verification state recording which gates have been
  positively proven for that order. Scoped by order id; drives completion enforcement.
- **Effect**: The tagged outcome a verified credential produces — `gate()` (hard block), `discount()`, or
  `authorize()` (settles last). This feature's pack uses `gate()`.
- **Professional-license pack**: A worked `defineCredential` credential (a `gate()` conditional to a
  license-restricted line, positive claim `license_active`), plus its runnable example and docs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can add a new credential type that completes on the phone **without adding or
  editing any ceremony/rail code path** — the professional-license pack is expressed as a `defineCredential`
  call plus a policy entry only, with no new rail, switch case, or registration call.
- **SC-002**: 100% of applicable `gate()` credentials (built-in and custom) are enforced at completion — an
  order with an unverified applicable `gate()` credential is refused on **every** payment/completion path, recording
  nothing.
- **SC-003**: Every new security bypass test fails (goes red) when its control is removed, and every existing
  security bypass test remains green (no regression).
- **SC-004**: Zero custom-credential surfaces present as issuer-verified — 100% report
  `presence-only-demo`.
- **SC-005**: A gate proven for one order grants completion for **zero** other orders (per-order scoping holds
  under test).
- **SC-006**: The `ARCHITECTURE.md` extension-points description matches observable behavior — a reviewer
  following the documented "no new code path" recipe reproduces a working custom gate.

## Assumptions

- **Design approach — register-on-resolve (Approach 1)**: The gate populates its internal id→credential
  registry as it resolves policies, requiring no new public registration API. Chosen in brainstorm over an
  explicit config-time credential set or a seam-published set, because it preserves Principle V's "no
  registration step" literally.
- **Single pack**: One curated credential ships — a professional-license `gate()`. It exercises the new
  completion-enforcement path (a non-age `gate()` credential) and, together with the existing `prescription`
  example, demonstrates the generalized gate path. Additional packs become a docs/example exercise once the
  rail is generic and are not part of this feature.
- **Format**: mdoc / OpenID4VP only, matching the existing credential rail. SD-JWT VC is a separate follow-up.
- **Test bar**: Acceptance is the instant-demo claims path plus bypass tests (each red when its control is
  removed). Real-wallet end-to-end proving is out of scope and depends on a dev test-issuer / wallet interop,
  filed separately (the issue flags this dependency; it currently has no tracking issue).
- **Reserved ids**: `age`, `membership`, and `payment` remain reserved for the built-in order-parameterized
  path; a custom credential is expected to use its own distinct id.
- **Built-ins unchanged**: The age and membership rail paths keep their order-derived parameters (threshold /
  percent). Only the new generic path is added for custom credentials; age/loyalty completion derivation is
  left untouched to keep the change's blast radius minimal.
- **Honesty dependency**: `presence-only-demo` remains the ceiling until issuer/device-signature verification
  (issue #14) lands; this feature does not change the trust anchor.
