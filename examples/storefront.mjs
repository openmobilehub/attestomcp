// A credential-gated agentic storefront in ~8 lines.
//
//   npm run build:packages        # build the two @openmobilehub/credentagent-* packages
//   node examples/storefront.mjs  # → http://localhost:3005/mcp
//
// Then add http://localhost:3005/mcp to Goose (Add Extension → Streamable HTTP).
// Try: "what do you sell?" → "add the whiskey and check out" (age 21+ is surfaced)
//      → "add the headphones and check out" (no age gate).
//
// `credentagent.mount(store.app)` reads the ceremony seams the storefront published on
// `store.app.locals.credentagent` and wires the ceremony rails onto THIS server, so the
// checkout page links to real /credentagent/* routes the buyer can complete end-to-end:
// prove age → present membership → authorize payment, recorded so get-order-status
// reflects it. Set GATE_SECRET for a stable challenge key across restarts (a dev
// server uses an ephemeral per-process key otherwise).

import { createStorefront } from "@openmobilehub/credentagent-storefront/server";
import { CredentAgent, age, membership, payment, required, optional } from "@openmobilehub/credentagent-gate";

const store = createStorefront({ signingKey: process.env.GATE_SECRET }); // the whole storefront — one line
const credentagent = new CredentAgent();
credentagent.mount(store.app);                          // …reads the seams + wires the /credentagent/* ceremony rails

const hasAlcohol = (order) => order.lines.some((l) => l.minimumAge != null);
store.gate((order) =>                              // …and gates the checkout tool (payment settles LAST)
  credentagent.requirements(order, [
    required(age.over(21).when(hasAlcohol)),        // 21+ — only when the cart has alcohol
    optional(membership.discount(10)),              // 10% off with a loyalty credential
    required(payment.in("usd")),                    // amount derived from the order; settles last
  ]),
);

const { url } = await store.listen(Number(process.env.PORT ?? 3005));
console.log(`\n  ✓ CredentAgent-gated storefront running → ${url}`);
console.log(`  Add it to Goose as a Streamable HTTP connector, then ask it to buy the whiskey.\n`);
