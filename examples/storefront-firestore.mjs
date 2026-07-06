// Same gated storefront as examples/storefront.mjs, but with a FIRST-CLASS DYNAMIC
// FIRESTORE CATALOG (spec 006) — edit products in Firestore, no redeploy.
//
//   npm run build                                        # build the two packages (dist/)
//   npm i firebase-admin                                 # the optional peer dep (Firestore path only)
//   export GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json  # service-account creds (or use ADC)
//   export FIRESTORE_COLLECTION=products                 # collection of product docs (default: products)
//   export WALLET_ORIGIN=https://<your-public-host>      # the origin your PHONE will open
//   export GATE_SECRET=$(openssl rand -hex 32)           # stable nonce key across restarts
//   node examples/storefront-firestore.mjs               # → http://localhost:3005/mcp
//
// WHY FIRESTORE IS OBSERVABLE HERE: edit a product's price (or add one) in the Firestore
// console, wait out the TTL (default 5 min), and the catalog + checkout prices update with
// NO redeploy — the module loads + caches the catalog server-side and re-derives prices
// and age gates from it on every path. Set no creds and it falls back to the static
// SAMPLE_CATALOG, so the file runs with zero setup.

import { createStorefront, SAMPLE_CATALOG } from "@openmobilehub/attestomcp-storefront/server";
import { firestoreCatalog } from "@openmobilehub/attestomcp-storefront/firestore";
import { AttestoMCP, age, membership, payment, required, optional } from "@openmobilehub/attestomcp-gate";

const useFirestore = !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT);
const collection = process.env.FIRESTORE_COLLECTION ?? "products";

// ← the whole feature: a live catalog with one option. No creds ⇒ static SAMPLE_CATALOG.
const catalog = useFirestore ? firestoreCatalog({ collection, ttlMs: 300_000 }) : SAMPLE_CATALOG;

const walletOrigin = process.env.WALLET_ORIGIN; // the PUBLIC https origin the phone opens

const store = createStorefront({
  catalog,
  baseUrl: walletOrigin, // checkout links resolve from the public origin
  signingKey: process.env.GATE_SECRET, // stable challenge key → survives a restart
});
const attestomcp = new AttestoMCP({ walletOrigin });
attestomcp.mount(store.app); // wires the real /attestomcp/* ceremony rails onto this server

const hasAlcohol = (order) => order.lines.some((l) => l.minimumAge != null);
store.gate((order) =>
  attestomcp.requirements(order, [
    required(age.over(21).when(hasAlcohol)), // 21+ only when the cart has alcohol (from the catalog)
    optional(membership.discount(10)), // 10% off with a loyalty credential
    required(payment.in("usd")), // amount derived from the order; settles last
  ]),
);

const { url } = await store.listen(Number(process.env.PORT ?? 3005));
console.log(`\n  ✓ AttestoMCP storefront running → ${url}`);
console.log(`  catalog     : ${useFirestore ? `Firestore (collection "${collection}", 5-min TTL)` : "STATIC SAMPLE_CATALOG — set GOOGLE_APPLICATION_CREDENTIALS for Firestore"}`);
console.log(`  walletOrigin: ${walletOrigin ?? "(unset — set WALLET_ORIGIN to your public https origin)"}`);
console.log(`  next: expose it (cloudflared tunnel --url ${url.replace("/mcp", "")}) and add <public>/mcp to Claude.\n`);
