# `grants-preapproved/` — approve a spending limit once, let the agent buy against it

You're heads-down for a week and want your AI agent to keep you in coffee. You don't want to
tap "approve" for every cup — and you don't want the agent to have a blank check either. This
example is the smallest real thing that makes that safe: you approve **one limit** ("up to
$15 per purchase, $50 total, at this café"), and the agent spends against it **while you're
away** — capped, replay-safe, revocable, and never for age-restricted items.

Two things run **once at startup** (`grants.serve()`, `on()`); `grants.create()` runs when
the agent asks for authority; `grant.spend()` runs per purchase, unattended:

```js
import express from "express";
import { CredentAgent, usd } from "@openmobilehub/credentagent-gate";

const app = express();
app.use(express.json());
const credentagent = new CredentAgent({
  walletOrigin: "http://localhost:4000",
  catalog: { coffee: 4.5, beans: 14 },                   // the price authority — spends name a sku, never an amount
});

// ── once, at startup ──────────────────────────────────────────
credentagent.grants.serve(app);                          // the approve page at each grant's approveUrl
credentagent.on("order.settled", ({ id }) => fulfill(id));

// ── the agent asks for authority — hand the link to the human ──
const grant = await credentagent.grants.create({
  merchant: "corner-cafe",
  budget: usd.dollars(50), perSpend: usd.dollars(15),    // Money — never a raw number
  policy: [],
});
sendToUser(grant.approveUrl);                            // ONE approval, then the agent is on its own

// ── later — human away — spend against it ─────────────────────
const g = await credentagent.grants.retrieve(grant.id);
if (g.status === "authorized") {
  const s = await g.spend({ idempotencyKey: "p1", items: [{ sku: "coffee" }] });
  // → { ok: true, amount, remaining }  ·  { ok: false, code: "budget-exceeded" | "per-spend-exceeded" | "revoked" | … }
}
```

## Run it

```bash
npm run build                                   # build the @openmobilehub/credentagent-* packages
node examples/grants-preapproved/server.mjs     # → http://localhost:4000
node examples/grants-preapproved/smoke.mjs      # the whole flow + asserts, no browser
```

Then:

1. `curl -X POST http://localhost:4000/setup-coffee-fund` → `{ id, approveUrl }`
2. Open the `approveUrl` → **Approve this limit** (the one human step)
3. `curl -X POST http://localhost:4000/buy/<id> -H 'content-type: application/json' -d '{"purchaseId":"p1","sku":"coffee"}'` → spends, unattended
4. `curl -X DELETE http://localhost:4000/grants/<id>` → revoked; the next spend refuses

## What's honestly enforced (and what isn't)

- **Enforced, tested:** per-purchase cap, cumulative budget, replay-safe retries (reuse the
  `purchaseId`), revocation, and **age-restricted items never complete on autopilot** — they
  refuse with `step-up` (a live human ceremony is the only way).
- **Demo-fenced:** trust is `server-issued-demo` — the approval key is minted by this server,
  not the user's wallet, and no real value moves. A grant whose `policy` names a credential
  (e.g. `required(age.over(21))`) renders its requirements but **cannot** be approved from
  the demo button (403) — rails-backed grant approval lands with the wallet-custody increment.
