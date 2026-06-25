# @openmobilehub/attesto-storefront

**The agentic storefront core.** The cart → priced-cart → order model an MCP shopping
app needs, **catalog-injected** — bring your own products. Own-the-code: fork it and
edit your catalog. Pairs with [`@openmobilehub/attesto-gate`](../attesto-gate) for
credential-gated checkout.

> **Design preview / v0.1 slice.** This package ships the pure pricing/order model
> (real and tested). The MCP shopping tools and the own-the-code widget bundle that
> render it are extracted from the reference server
> ([mcp-apps-shopping-demo](https://github.com/openmobilehub/mcp-apps-shopping-demo))
> on the roadmap.

```ts
import { priceCart, createOrder, requiredAgeForLines, SAMPLE_CATALOG } from "@openmobilehub/attesto-storefront";

const cart = priceCart([{ productId: "oak-whiskey", quantity: 1 }], SAMPLE_CATALOG);
cart.hasAgeRestricted;                       // true → wire @openmobilehub/attesto-gate on checkout
requiredAgeForLines(cart.lines, SAMPLE_CATALOG); // 21

const order = createOrder([{ productId: "oak-whiskey", quantity: 1 }], "ORD-1", SAMPLE_CATALOG);
order.total;                                  // 124
```

`minimumAge` on a product is the one field that ties the two packages together: set
it, and a Gate on `checkout` locks payment until age is proven.

## What's real in v0.1

- `priceCart()` / `createOrder()` / `requiredAgeForLines()` — pure, catalog-injected.
- The `Product` / `Order` / `PricedCart` model and a runnable `SAMPLE_CATALOG`.
- Loyalty discount with a per-call percent override.

Apache-2.0 · part of [Open Mobile Hub](https://openmobilehub.org) (Linux Foundation).
