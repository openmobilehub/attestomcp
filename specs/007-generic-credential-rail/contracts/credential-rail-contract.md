# Contract: The generalized credential rail + completion enforcement

The interface behaviors this feature changes. As a library, the "contract" is the observable behavior of the
public API (`defineCredential`, `requirements`, `mount`) and the internal seams (`/credentagent/credential`
routes, `completeOrder`). Reserved built-in ids (`age`/`membership`/`payment`) are explicitly out of these
generalized paths and keep their existing behavior.

## C1 — `requirements()` registers policy credentials (Context 1)

- **Given** `credentagent.requirements(order, policy)`
- **Then** for each `step` in `policy`, `step.credential` is added to the instance registry keyed by
  `credential.id` (last write wins for a repeated id).
- **And** the call remains **synchronous** and returns the same flat manifest as before (no shape change).
- **And** no function from any credential appears in the returned manifest (Principle VI unchanged).

## C2 — `GET /credentagent/credential?order=<id>&cred=<credId>` (ceremony page)

- **Given** `credId` resolves to a registered custom credential
- **Then** the page renders for that credential using its `ui`, the re-priced order, and the presence-only
  honesty banner.
- **Given** `credId` is neither a built-in kind nor a registered id
- **Then** respond `404` "Unknown credential" (unchanged shape for the unknown case).

## C3 — `GET /credentagent/credential/request?order=<id>&cred=<credId>` (signed request)

- **Given** a registered custom `credId`
- **Then** the signed OpenID4VP request embeds **that credential's own `request` DCQL** (doctype + claim
  leaves), and the `org-iso-mdoc` request carries the single doctype/elements derived from the same DCQL.
- **And** the request is ES256-signed, origin/RP-bound, and carries a sealed reader context (ephemeral ECDH
  key + fresh nonce) — identical crypto to the built-in path (invariant 6).
- **And** `trust_level` is `"presence-only-demo"`.

## C4 — `POST /credentagent/credential/verify` (both paths)

- **Given** `cred=<credId>` for a registered custom credential and either an instant-demo `claims` object or a
  real wallet `result`
- **When** the disclosed claims satisfy the credential's own `verify(claims)` (an explicit positive)
- **Then** `verifiedGates[credId] = true` is written to the order's `VerificationRecord` (keyed by order id).
- **When** the claims do **not** satisfy `verify` (negative/absent/wrong claim)
- **Then** nothing is recorded for that gate; the response reports not-verified.
- **And** the order is resolved through `resolveOrder` (re-priced; a tampered/unknown id is refused) exactly
  as today.

## C5 — `completeOrder(input, ctx)` enforces applicable custom gates (the security core)

- **Given** a re-priced order and the injected registry
- **When** any registry credential is not a reserved built-in id, has `effect.kind === "gate"`, and its
  `appliesTo(repriced)` is true (or absent)
- **Then** completion requires `verifiedGates[id] === true` in the order's record; if any required one is
  missing, completion refuses with `reason: "gate"` and writes **no** completed record.
- **And** this runs on **every** rail's completion (passkey, dc-payment, instant-demo) because they all call
  `completeOrder` (invariant 1).
- **And** applicability is computed from the **re-priced** order, never the token (invariant 2).
- **And** age/loyalty/payment enforcement, idempotency, cart-mandate + reconciliation checks are unchanged.

## C6 — `defineCredential` (public API, behavioral contract)

- **Given** a developer defines a credential by object and places it in the policy
- **Then** it completes on the phone through C2–C5 with **no** new rail, no switch-case edit, and no
  registration call — the only developer action is `defineCredential({...})` + a policy entry.
- **And** its `verify`/`appliesTo` execute **server-side only**; they never cross the wire.

## Non-goals (explicitly out of contract)

- SD-JWT VC format (mdoc/OpenID4VP only here).
- Issuer/device-signature trust (`trust_level` stays `presence-only-demo`; ties to #14).
- Real-wallet end-to-end proving of a new doctype (needs a dev test-issuer; separate dependency).
- `optional(gate())` semantics — a `gate()` credential is enforced when applicable regardless of the
  `required` flag (see research D4); `optional` remains meaningful for `discount()`/`authorize()`.
