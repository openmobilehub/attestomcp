# Feature Specification: AP2 Mandate-Chain Developer Surface (`MandateBundle`)

**Feature branch:** `008-ap2-mandate-chain-dx` · **Issue:** #92 · **Date:** 2026-07-20

## Overview

The library already builds all three AP2 mandates internally — the **Intent Mandate**
(`IntentBounds` / `sealIntent`), the **Cart Mandate** (`ap2.CartMandate` / `issueCartMandate`),
and the **Payment Mandate** (`ap2.PaymentMandate` / `buildPasskeyMandate`) — but never hands
them back as a consistent, retrievable artifact. A developer who wants to inspect, log, or pass
a signed mandate on to another AP2 component or the payment network has no first-class way to get
it.

This feature adds a single shared return shape, **`MandateBundle`**, exposed by **both** consent
surfaces: the human-present live-ceremony path (`requirements()` + `mount()`, and #17's
`gateTool()`) and the human-not-present delegated path (`DelegatedGate.preApprove()` / `spend()`).
The two **entry surfaces stay separate** — each is honest to a genuinely different developer
situation (a live user signing a cart *now* vs pre-authorizing bounds for *later*) — but the
**output shape unifies**. Per AP2, "human present vs not" is a **flag on the Payment Mandate**,
not a separate pipeline.

Everything remains **dev-signed, presence-only** (constitution VII); this feature exposes the
existing demo mandates, it does not add real signing (that is #14/#39).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Retrieve the mandates after a human-present checkout (Priority: P1)

A developer integrating the HP checkout completes a ceremony and wants the signed Cart + Payment
mandate for their records / to forward to the payment network.

- Given a completed HP order, when the developer reads the completion result, then a
  `MandateBundle` is present with `cartMandate` (user-signed) and `paymentMandate`
  (`presence: "human_present"`), and `intentMandate` is `undefined`.
- No manual assembly: the bundle is one property access off the result.

### User Story 2 - Retrieve the mandate chain from a delegated (HNP) spend (Priority: P1)

A developer using `DelegatedGate` for an agent that buys while the human is away wants the full
chain that authorized a purchase.

- Given a grant from `preApprove()`, when the developer reads `grant.intentMandate`, then they get
  the user-signed `IntentBounds`.
- Given a successful `spend()`, when they read the result's `mandates`, then a `MandateBundle`
  holds `intentMandate`, the algorithmically-generated `cartMandate`, and `paymentMandate`
  (`presence: "human_not_present"`, pointing at the cart).

### User Story 3 - Branch on presence (Priority: P2)

A developer routes to different downstream handling for delegated vs live purchases.

- Given any `MandateBundle`, when they read `paymentMandate.presence`, then it reliably reports
  `"human_present"` or `"human_not_present"`.

### User Story 4 - Hand a mandate to another AP2 component (Priority: P2)

A developer forwards a `cartMandate` / `paymentMandate` to another AP2 agent or a settlement step.

- Given a bundle, when they serialize a mandate, then it is a plain JSON object carrying its own
  honesty marker (`signature.note` / `trust_level`) so the recipient cannot mistake demo trust for
  issuer-verified trust.

### Edge Cases

- **HP has no Intent Mandate today** → `intentMandate` is `undefined` on the HP bundle. Do NOT
  synthesize a placeholder to force symmetry.
- **A refused HNP spend** (over-cap / revoked / replay) → no `cartMandate` / `paymentMandate` is
  produced; the bundle represents only an *authorized* draw. The refusal stays the typed
  `SpendResult` reason.
- **Honesty** → every exposed object must read as dev-signed presence-only; none may imply
  issuer/device-signed trust.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Define a `MandateBundle` type: `{ intentMandate?: IntentBounds; cartMandate:
  CartMandate; paymentMandate: PaymentMandate }`.
- **FR-002**: The HP completion path surfaces a `MandateBundle` (`cartMandate` user-signed,
  `paymentMandate.presence = "human_present"`, `intentMandate` absent).
- **FR-003**: `DelegatedGate` grants expose `grant.intentMandate`; each successful `spend()`
  surfaces a `MandateBundle` (`presence = "human_not_present"`).
- **FR-004**: `paymentMandate` carries the `presence` flag and a pointer to its `cartMandate`.
- **FR-005**: Every mandate object surfaces its honesty (dev-signed, presence-only); nothing may
  read as issuer-verified (constitution VII).
- **FR-006**: **Additive only** — no change to the behavior or existing signatures of
  `preApprove` / `spend` / `requirements` / `gateTool` / `completeOrder`; the bundle is extra
  return data. No existing test changes its expectations.
- **FR-007**: A refused draw exposes no cart/payment mandate; the bundle represents authorized
  draws only.

### Key Entities

- **MandateBundle** — the shared return artifact; the three AP2 mandates that apply.
- **IntentBounds** (Intent Mandate) — user-signed bounds; present only for HNP.
- **CartMandate** (`ap2.CartMandate`) — the exact priced cart; user-signed (HP) or agent-generated
  (HNP).
- **PaymentMandate** (`ap2.PaymentMandate`) — derived; carries the presence flag + cart pointer.

## Success Criteria *(mandatory)*

- **SC-001**: From either surface, a developer retrieves the signed mandates via a single property
  access on the result — no manual assembly, no low-level primitive calls.
- **SC-002**: Tests assert `presence` correctly distinguishes HP from HNP on real bundles.
- **SC-003**: The whole change is additive — the existing gate + storefront suites pass unchanged.
- **SC-004**: Honesty is visible in the exposed types/fields; a bypass-style test asserts no object
  claims issuer-verified trust.

## Assumptions

- Builds on the existing `IntentBounds`/`sealIntent`, `CartMandate`/`issueCartMandate`,
  `PaymentMandate`/`buildPasskeyMandate` implementations.
- Dev-signed presence-only remains the trust level; real key-bound signing is out of scope (#14/#39).
- The HP exposure point is the completion result (`completeOrder` / the `gateTool()` proven path);
  confirming/adding that surfacing is part of the implementation.

## Out of Scope

- Wire-format / SD-JWT mandate serialization (#39) and cross-SDK conformance vs the Python AP2 SDK
  (#40) — this feature is the **developer surface**, not the wire format.
- New or key-bound signing (#14).
- Redesigning `DelegatedGate` or the intent rail (#12, #69–71).
- The `gateTool()` internals (#17) — it ships mandates-hidden; this adds the exposure additively.
- A single polymorphic entry point (rejected in favor of two honest surfaces + one shared output).

## Dependencies

- **#12 / #69–71** — the HNP intent rail / `DelegatedGate` surface this exposes (the `005-*`
  worktrees). Build on, do not redesign.
- **#17** — `gateTool()` (HP page-less); independent, additive.
- **Constitution** — Principle I (Stripe-grade, no grab-bags), Principle VII (honesty in types),
  Security "per-order state" (bundles are per order/draw, never process-global).
