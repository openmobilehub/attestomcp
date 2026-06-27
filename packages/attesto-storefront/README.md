# @openmobilehub/attesto-storefront

**The agentic storefront core.** A runnable MCP shopping server — the cart → priced-cart →
order model + the nine shopping tools + the widget bundle — **catalog-injected** (bring your
own products, own-the-code). Pairs with
[`@openmobilehub/attesto-gate`](../attesto-gate) so you can **gate any consequential MCP tool
with any credential**: age, membership, a prescription, payment. **Payments is one application
of the same gate, not the point** — `minimumAge` on a product is all it takes to lock checkout.

> **Design preview / v0.1.** The pure pricing/order model (`@openmobilehub/attesto-storefront`)
> and the runnable MCP server (`@openmobilehub/attesto-storefront/server`) are real and tested.
> Some of the demo's widget polish is still being extracted from the reference server
> ([mcp-apps-shopping-demo](https://github.com/openmobilehub/mcp-apps-shopping-demo)).
> See the repo's `ROADMAP.md`.

## Install

```bash
npm install @openmobilehub/attesto-storefront @openmobilehub/attesto-gate
```

Apache-2.0, ESM. Two entry points: `.` (the pure pricing model, dependency-light) and
`./server` (the runnable MCP server, brings in `@modelcontextprotocol/sdk` + `express`).

## Quickstart — a credential-gated storefront in ≤ 10 lines

`createStorefront()` stands up the real MCP server (nine tools, a widget resource, a checkout
page) over HTTP at `/mcp`. It publishes the ceremony seams on `store.app.locals.attesto`, so
`new Attesto().mount(store.app)` wires the real `/attesto/*` ceremony rails with zero glue, and
`store.gate()` resolves your policy on every `checkout` call (copied from
[`examples/storefront.mjs`](../../examples/storefront.mjs) /
[`storefront-gate.test.ts`](../../storefront-gate.test.ts)):

```ts
import { createStorefront } from "@openmobilehub/attesto-storefront/server";
import { Attesto, age, membership, payment, required, optional } from "@openmobilehub/attesto-gate";

const store = createStorefront();                  // the whole storefront — one line
const attesto = new Attesto();
attesto.mount(store.app);                          // wires the real /attesto/* ceremony rails

store.gate((order) =>                              // resolved on every checkout (payment settles LAST)
  attesto.requirements(order, [
    required(age.over(21).when((order) => order.lines.some((l) => l.minimumAge != null))),
    optional(membership.discount(10)),              // 10% off if a loyalty credential is presented
    required(payment.in("usd")),                    // amount derived from the order; settles last
  ]),
);

const { url } = await store.listen(3005);          // → add http://localhost:3005/mcp to Claude / ChatGPT / Goose
```

Browse → add the whiskey (21+) → checkout. The `checkout` tool returns the link **plus** a
`requires` manifest; the buyer proves age + (optionally) membership, then authorizes payment on
the `mount()`-served page; the widget polls and shows the discounted confirmation. Add the
headphones instead and the age gate drops — the `.when()` predicate receives the **order** and is
false. Without `store.gate(...)` the storefront is ungated: a plain checkout link, no `requires`.

> The product's `minimumAge` is the single field that ties the two packages together: `priceCart`
> re-derives it onto each priced line, so a storefront `Order` feeds `attesto.requirements()`
> directly — no mapping. The gate's amount is **re-derived server-side from this catalog**, never
> trusted from the order token (Security invariant 2).

## The three execution contexts

`createStorefront()` is built around the split the gate enforces — conflating these is forbidden
([spec §0](../../specs/001-attesto-sdk/spec.md)):

1. **Tool — mints the link + reports requirements.** The `checkout` tool snapshots the cart into an
   order, returns `{ orderId, checkoutUrl, requires }`, and runs **no ceremony** (no phone in the loop).
2. **Page — runs the gates.** `GET /checkout?order=<id>` links to the `/attesto/*` ceremony routes
   `attesto.mount(store.app)` serves; the buyer completes every gate there in one session.
3. **Poll — reports completion.** The widget polls `GET /checkout/order-status?orderId=<id>`; once the
   ceremony's shared `completeOrder` records the order (re-priced, age re-enforced, cart cleared), it
   reflects the completed — discounted — total.

## Pure pricing model (no server)

The `.` entry point is the pure, catalog-injected pricing core — useful standalone or to fork:

```ts
import { priceCart, createOrder, requiredAgeForLines, SAMPLE_CATALOG } from "@openmobilehub/attesto-storefront";

const cart = priceCart([{ productId: "oak-whiskey", quantity: 1 }], SAMPLE_CATALOG);
cart.hasAgeRestricted;                            // true → wire @openmobilehub/attesto-gate on checkout
requiredAgeForLines(cart.lines, SAMPLE_CATALOG);  // 21

const order = createOrder([{ productId: "oak-whiskey", quantity: 1 }], "ORD-1", SAMPLE_CATALOG);
order.total;                                      // 124
```

Pure functions — no globals — so the same code serves any storefront. Pass your own `Product[]` as
the catalog; unknown ids are collected (`unknownIds`), not thrown.

## What's real in v0.1

- `createStorefront(opts)` → `{ app, catalog, gate, listen, mcpServer }` — the runnable MCP server
  (nine tools, widget resource, checkout page) over HTTP, catalog-injected, gate-ready.
- `priceCart()` / `createOrder()` / `requiredAgeForLines()` / `getProduct()` / `getReviews()` — pure,
  catalog-injected pricing & lookups.
- The `Product` / `Order` / `PricedCart` / `PricedCartLine` model + a runnable `SAMPLE_CATALOG`
  (includes one 21+ item) so the package demos itself.
- Loyalty discount with a per-call percent override (`LOYALTY_DISCOUNT_PCT`, `PriceOpts`).
- Pluggable stores (cart / created-order / completed-order / verification) — default in-memory;
  inject a shared store (e.g. Redis) for a multi-instance serverless deployment.

`createStorefront()` accepts `{ catalog, reviews, baseUrl, cartStore, orderStore, createdOrderStore,
verificationStore, signingKey, allowEphemeralKey, settle }`. The optional `settle` seam (e.g.
on-chain) **gates** completion: a configured-but-failed settle records nothing and leaves the cart
intact.

## Honest status

The composed gate is **presence-only** in v0.1 (`trust_level: "presence-only-demo"`): the passkey rail
is real WebAuthn cryptography, but the age/membership and Digital-Credentials payment rails enforce
disclosure + binding, **not** mdoc issuer/device-signature trust — a flow demo, not a real safety
control. See [`@openmobilehub/attesto-gate`](../attesto-gate#honest-status) for the full breakdown.

Apache-2.0 · part of [Open Mobile Hub](https://openmobilehub.org) (Linux Foundation).
