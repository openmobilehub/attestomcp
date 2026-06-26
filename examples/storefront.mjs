// A credential-gated agentic storefront in ~8 lines.
//
//   npm run build:packages        # build the two @openmobilehub/attesto-* packages
//   node examples/storefront.mjs  # → http://localhost:3005/mcp
//
// Then add http://localhost:3005/mcp to Goose (Add Extension → Streamable HTTP).
// Try: "what do you sell?" → "add the whiskey and check out" (age 21+ is surfaced)
//      → "add the headphones and check out" (no age gate).

import { createStorefront } from "@openmobilehub/attesto-storefront/server";
import { Attesto, age, membership, payment, required, optional } from "@openmobilehub/attesto-gate";

const store = createStorefront();                 // the whole storefront — one line, nothing to configure
const attesto = new Attesto();
attesto.mount(store.app);                          // Attesto mounts onto it

const hasAlcohol = (order) => order.lines.some((l) => l.minimumAge != null);
store.gate((order) =>                              // …and gates the checkout tool
  attesto.requirements(order, [
    required(age.over(21).when(hasAlcohol)),        // 21+ — only when the cart has alcohol
    optional(membership.discount(10)),              // 10% off with a loyalty credential
    required(payment.in("usd")),                    // amount derived from the order; settles last
  ]),
);

const { url } = await store.listen(Number(process.env.PORT ?? 3005));
console.log(`\n  ✓ Attesto-gated storefront running → ${url}`);
console.log(`  Add it to Goose as a Streamable HTTP connector, then ask it to buy the whiskey.\n`);
