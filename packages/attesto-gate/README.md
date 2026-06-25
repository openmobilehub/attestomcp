# @openmobilehub/attesto-gate

**The consent layer for AI agents.** An AI agent must prove a verifiable credential
from the user's phone wallet before a consequential MCP tool completes. **Identity
leads; payments is one application.**

> **Design preview / v0.1.** This package is real and tested, but the broader Attesto
> SDK is still being extracted from the reference server
> ([mcp-apps-shopping-demo](https://github.com/openmobilehub/mcp-apps-shopping-demo)).
> See the repo's `ROADMAP.md` for what's shipping vs. next.

## The idea

When an agent calls a gated tool and the buyer hasn't proven the required credential,
the tool returns a typed **`verification_required`** envelope an agent can *drive* —
why it stopped, which credential, a per-order approve link, and the tool to poll —
instead of a dead error string. A refused tool call is a protocol, not a wall.

```ts
import { gated, ageDcql } from "@openmobilehub/attesto-gate";

const checkout = gated(
  async (args, { order }) => ({
    structuredContent: { orderId: order.id, checkoutUrl: linkFor(order) },
    content: [{ type: "text", text: "checkout ready" }],
  }),
  { age: true },
  {
    resolveOrder: (args) => buildOrder(args),          // created once — stable id
    isAgeUnverified: (order) => store.isAgeUnverified(order),
    approveUrl: (order) => `${origin}/credential-gate/age?order=${token(order)}`,
    minAge: (order) => requiredAge(order),
  },
);
```

If the cart is age-restricted and unproven, `checkout(args)` returns a
`verification_required` envelope; otherwise it runs your handler.

## What's real in v0.1

- `buildVerificationRequired()` / `isVerificationRequired()` — the agent-drivable envelope.
- `gated()` — wraps a tool handler to enforce the **age** gate at the tool layer.
- `ageDcql()` — the DCQL request, matching the reference ISO 18013-5 mDL verifier.
- `requireCredential` / `optionalCredential`, the credential model, and types.

## Honest status

The reference verifier enforces **disclosure** (an explicit positive claim, not
token-presence) and **binding** (nonce / ephemeral key), but **not trust** (issuer /
device signatures) — a self-crafted mdoc would pass. The envelope says so
(`trust_level: "presence-only-demo"`). This is a flow demo, not a safety control,
until mdoc trust verification lands (Multipaz / `@auth0/mdl`). See the roadmap.

`mountGate()` (mounting the full OpenID4VP ceremony routes) is provided by the
reference server today; its extraction into this package is on the roadmap.

Apache-2.0 · part of [Open Mobile Hub](https://openmobilehub.org) (Linux Foundation).
