<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0 (2026-07-08)
- Bump rationale: MINOR — materially expanded guidance on Principles II, III, VII for Human-Not-Present
  (HNP) delegation (005 Decision 13, ratified by the maintainer 2026-07-08 per
  specs/005-human-not-present/constitution-amendment-draft.md). No principle removed or redefined
  incompatibly — every pre-existing rule remains true for human-present flows.
- Amended: II (Context 1 may VERIFY a pre-existing delegation grant; redeeming is not a ceremony) ·
  III (consolidation for HNP = one delegate ceremony + full server-side gate chain on every redemption) ·
  VII (orthogonal `presence` axis; `trust_level` gains `server-issued-demo`, weaker than
  `presence-only-demo`; `enforcedAt` gains `"intent"`).
- Added sections: Terminology & Retained-Primitive Rulings (envelope vs grant; Mode-B gated() retained).
- Templates checked for alignment:
    ✅ plan-template.md — Constitution Check instantiated per-plan; 005's plan already reflects the
       amended II/III/VII rows
    ✅ spec-template.md — no change required
    ⚠ tasks-template.md — generated tasks MUST include security-bypass tests + DCO (unchanged obligation)
    ⚠ CLAUDE.md — honesty-fencing section gains the presence axis AT 005 IMPLEMENTATION TIME (the axis
       does not exist in code until then)
- Deferred TODOs: none
-->

# CredentAgent SDK Constitution

CredentAgent is the open consent layer for AI agents: an agent MUST prove a verifiable credential from the
user's phone wallet before a consequential MCP tool completes. Identity leads; payments is one application.
These articles are non-negotiable — a change that violates one is blocking, even in demo code.

## Core Principles

### I. Stripe-grade, MCP-idiomatic API
The public API MUST be configured once on a client (`new CredentAgent({...})`) and then driven by declarative
calls. Examples MUST show the MCP `inputSchema` inline so a handler's destructured fields trace to it, and
every value's origin MUST be visible on the page — NO injected-callback grab-bags, hidden config
variables, or mystery handler parameters. Rationale: a developer reads it once and understands it; the
benchmark is `stripe-node`.

### II. The three execution contexts are sacred
Every example and design decision MUST respect the split (spec §0): (1) the MCP tool handler runs ONCE when
checkout is requested and only mints the link + reports requirements — there is no phone in the loop, so it
MUST NOT perform a credential ceremony. It MAY, however, **verify a pre-existing delegation grant** minted
in an earlier, separate live ceremony: redeeming a grant is verification of consent already given, not a
new ceremony, and MUST run entirely server-side against the full gate chain. (2) the checkout page/phone is
where ceremonies actually run — including the **delegate ceremony** that mints a grant; (3) a poll reports
completion. Conflating these contexts is the documented root cause of confusion and is forbidden.

### III. Consolidated checkout flow
Checkout MUST be one handoff: the buyer opens the link once and completes all verifications and payment in
a single browser session. The agent orchestrates URLs and polls; it MUST NOT perform the ceremony. A
blocking-tool mode (for page-less tools) is roadmap, not v0.1.

These rules govern **human-present** flows. A human-not-present redemption has, by definition, no browser
session and no live buyer; its consolidation invariant is instead: **one delegate ceremony** (itself a
single consolidated handoff, per this principle) authorizes a bounded set of later redemptions, and **every
redemption runs the full server-side gate chain on every completion path** (Security Requirements). The
agent still only orchestrates and polls; it MUST NOT hold or perform authorization itself.

### IV. One ordered, conditional policy array
Gates MUST be expressed as a single ordered array: array position is run order, payment MUST settle last,
and the payment amount MUST be derived server-side from the order — never passed as a field. Gates are
`required(...)` or `optional(...)`. Conditionality MUST be explicit via `.when((order) => boolean)` (or a
credential's `appliesTo`); the SDK MUST NOT guess domain meaning (e.g. what counts as "alcohol") — the
predicate is the developer's.

### V. Extensible to any credential
The SDK MUST let a developer gate any consequential action with any credential via
`defineCredential({ id, request, verify, effect, ui })`, where effect is `gate()`, `discount()`, or
`authorize()`. The built-ins (`age` / `membership` / `payment`) are merely pre-defined credentials. Custom
credentials MUST be usable by object, with no registration step. This is the core promise of the product.

### VI. structuredContent is data, not policy
A tool result is JSON over the MCP wire to BOTH the agent and the widget, so it MUST be plain JSON.
`requirements()` MUST resolve the policy server-side (running the `.when()` / `verify` functions) and emit
a flat data manifest (`[{ credential, required, effect, label, minAge? }]`). Functions MUST NOT cross the
wire; `requirements()` is the code→data boundary.

### VII. Honesty in the types; prefer simplicity
Status MUST be carried in types, not prose: `enforcedAt: "tool" | "checkout" | "intent"`, an orthogonal
**`presence`** axis (`"live" | "delegated-demo" | "delegated"`) carrying *when consent happened*, and
`trust_level` (`"presence-only-demo" | "server-issued-demo" | "issuer-verified"`) carrying *how strongly
the authorization is bound* — the live-ceremony/nonce connotation lives on the presence axis, not in
`trust_level`. `"server-issued-demo"` is WEAKER than `"presence-only-demo"`: it proves issuance only, not
user authorization. Every `presence: "delegated-demo"` surface MUST carry a non-empty `disclaimer`, MUST
NOT expose any `authorizedByUser`-style field, and MUST NOT settle real value. A real HNP control requires
`presence: "delegated"` AND `trust_level: "issuer-verified"`. v0.1 human-present rails remain
presence-only (disclosure + nonce binding, NOT issuer/device signatures) and MUST be fenced as a
demonstration, never sold as a real safety control. Prefer simplicity — defer complexity (e.g. real
mdoc-verifier integration) rather than overbuild.

## Security Requirements

Load-bearing controls; a change that breaks one is blocking even in demo code (mirrors `CLAUDE.md`):

- **Enforce on every completion path.** Gates MUST run server-side on every path that can complete an
  order (the MCP tool, `place-order`, passkey/verify, dc-payment/verify), not just the rendered page.
  Hiding a button is not enforcement.
- **Never trust the order token.** Amounts and flags MUST be re-derived from the catalog server-side; the
  unsigned, hand-editable token is never authoritative.
- **Discounts reconcile with amount binding** across all payment paths (line sum = total = signed amount).
- **Per-order state.** Verification/cart state MUST be keyed by order/session id — never process-global
  (no cross-user bleed).
- **Explicit positive claims.** Verify the actual claim (`age_over_21 === true`), not token presence; an
  18+ proof MUST NOT satisfy a 21+ gate.
- **Origin & replay binding.** OpenID4VP / WebAuthn MUST stay bound to this server's origin with
  nonce/replay protection.

Until cryptographic mdoc trust verification (issuer/device signatures) lands, any gate relying on it MUST
be fenced behind a demo-only mode and MUST NOT be presented as a real safety control.

## Terminology & Retained-Primitive Rulings

- **"envelope"** refers ONLY to the Mode-B `verification_required` wire envelope (`envelope.ts`). A
  standing HNP authorization is a **grant** (typed `ap2.IntentMandate`); the merchant's standing
  delegation config is the **delegation policy**. The phrase "spending envelope" MUST NOT be used.
- **Mode-B `gated()`** and the wire envelope are **retained unchanged** as the page-less blocking
  primitive, decoupled from HNP. Async step-up (an HNP redeem answering with a blocking envelope) remains
  roadmap — explicitly out of 005's scope.

## Development Workflow & Quality Gates

- **Spec-grounded.** The spec and docs MUST cite real code (file/line). Claims that drift from the code are
  defects to fix.
- **Tested where it matters.** Security-critical / bypass paths MUST have tests; a test that still passes
  with the security control removed is not a useful test.
- **DCO.** Every commit MUST carry a `Signed-off-by:` line (`git commit -s`).
- **Deploy care.** Changes affecting the served origin or the build pipeline MUST be verified
  (`npm run build` green + a runtime smoke) before being claimed done.

## Governance

This constitution supersedes other practices for the CredentAgent SDK. Amendments MUST be made by editing this
file with a written rationale, MUST bump the version per the policy below, and MUST keep the dependent Spec
Kit templates (`plan`, `spec`, `tasks`) in sync. Every plan's Constitution Check and every review MUST
verify compliance with these articles; a deviation MUST be justified in writing, or the change is blocked.

Versioning (semantic): **MAJOR** — backward-incompatible principle removal or redefinition; **MINOR** — a
new principle/section or materially expanded guidance; **PATCH** — clarifications and wording. Runtime
guidance for agents lives in `CLAUDE.md` and `specs/001-attesto-sdk/spec.md`.

**Version**: 1.1.0 | **Ratified**: 2026-06-25 | **Last Amended**: 2026-07-08
