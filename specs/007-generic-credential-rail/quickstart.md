# Quickstart / Validation: Generic credential rail

Runnable checks that prove the feature end-to-end. Instant-demo claims path (the acceptance bar); real-wallet
proving is out of scope. Run from the repo root.

## Prerequisites

```bash
npm install
npm run build:packages        # build @openmobilehub/credentagent-* so the example resolves
```

## A. Automated validation (the source of truth)

```bash
npm run test --workspace @openmobilehub/credentagent-gate
```

Expected: all suites green, including the new generic-credential-rail suite. The new suite MUST include these
bypass assertions (each must fail when its control is removed):

1. **Unverified required custom gate is refused at completion.** Build an order whose catalog line makes a
   registered custom `gate()` credential applicable; POST it (unverified) to the completion path → refused
   with `reason: "gate"`, no completed record. *Red-check:* delete the completion registry sweep → this
   wrongly completes.
2. **Verify → complete.** POST the explicit positive claim (`{ license_active: true }`) for that order to
   `/credentagent/credential/verify?cred=professional_license`; then completion for the same order succeeds.
3. **Negative claim does not pass.** POST `{ license_active: false }` (or omit it) → not recorded → completion
   still refused. *Red-check:* weaken `verify` to token-presence → this wrongly passes.
4. **Per-order scoping.** Verify the gate for order A; attempt completion for order B (same credential,
   applicable) → B refused until it carries its own verification. *Red-check:* key `verifiedGates`
   process-globally → B wrongly completes.
5. **No regression.** The existing age-threshold, loyalty-reconciliation, and amount-binding bypass suites
   stay green unchanged.

## B. Manual walk with the pack example

```bash
node examples/professional-license.mjs      # → http://localhost:<port>/mcp
```

Then, driving the storefront's MCP tool (or curling the rails):

| Step | Action | Expected |
| :-- | :-- | :-- |
| 1 | Price a cart **with** the licensed line | The `Professional license` card is surfaced in the manifest (`appliesTo` fired), `trust_level: "presence-only-demo"`. |
| 2 | Price a cart **without** the licensed line | No license card (conditional gate absent). |
| 3 | Attempt to complete the licensed order before proving the license | Refused server-side (`reason: "gate"`) — not merely a hidden button. |
| 4 | `GET …/credentagent/credential/request?cred=professional_license&order=<id>` | Signed request embeds the credential's **own** doctype (`org.example.license.1`) + `license_active` claim — not an age/membership shape. |
| 5 | `POST …/credentagent/credential/verify` with `{ cred: "professional_license", order: "<id>", claims: { license_active: true } }` | `verified: true`; `verifiedGates.professional_license` recorded for the order. |
| 6 | Complete the licensed order again | Completes. |

## C. Docs check

- `ARCHITECTURE.md` "adding a new gate or credential" describes the now-true behavior: a new credential needs
  no new ceremony code path. Following its recipe reproduces steps 1–6 above.
- The pack docs state the presence-only-demo fence and the multi-instance registry warm-up note.

## Out of scope (do not attempt to validate here)

- Real wallet / real phone proving of `org.example.license.1` (no test-issuer for the doctype yet — separate
  dependency).
- SD-JWT VC credentials.
- Issuer/device-signature trust (`presence-only-demo` remains the ceiling).
