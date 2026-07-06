// Same gated storefront as examples/storefront.mjs, but with FIRST-CLASS REDIS
// PERSISTENCE (spec 005) — for an end-to-end phone test through Claude.
//
//   npm run build                                   # build the two packages (dist/)
//   export KV_REST_API_URL=...  KV_REST_API_TOKEN=...   # Upstash creds (else: in-memory)
//   export WALLET_ORIGIN=https://<your-public-host>     # the origin your PHONE will open
//   export GATE_SECRET=$(openssl rand -hex 32)          # stable nonce key across restarts
//   node examples/storefront-redis.mjs                  # → http://localhost:3005/mcp
//
// Expose it publicly (so the phone + Claude can reach it), e.g.:
//   cloudflared tunnel --url http://localhost:3005
// then add https://<tunnel-host>/mcp to Claude as a custom connector.
//
// WHY REDIS IS OBSERVABLE HERE: with Redis + a stable GATE_SECRET, you can add the
// whiskey / prove age, then RESTART this process (a fresh process = empty in-memory),
// reopen the same checkout link on your phone, and the cart + verification are STILL
// there — because they live in Redis, not process memory. In-memory would be gone.

import { createStorefront } from "@openmobilehub/attestomcp-storefront/server";
import { redisStorage } from "@openmobilehub/attestomcp-storefront/redis";
import { AttestoMCP, age, membership, payment, required, optional } from "@openmobilehub/attestomcp-gate";

const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const namespace = process.env.REDIS_NAMESPACE ?? "phone-demo";

const storage =
  redisUrl && redisToken ? redisStorage({ url: redisUrl, token: redisToken, namespace }) : undefined;

const walletOrigin = process.env.WALLET_ORIGIN; // the PUBLIC https origin the phone opens

const store = createStorefront({
  storage, // ← the whole feature: Redis-backed stores with one option (undefined ⇒ in-memory)
  baseUrl: walletOrigin, // checkout links resolve from the public origin
  signingKey: process.env.GATE_SECRET, // stable challenge key → survives a restart
});
const attestomcp = new AttestoMCP({ walletOrigin });
attestomcp.mount(store.app); // wires the real /attestomcp/* ceremony rails onto this server

const hasAlcohol = (order) => order.lines.some((l) => l.minimumAge != null);
store.gate((order) =>
  attestomcp.requirements(order, [
    required(age.over(21).when(hasAlcohol)), // 21+ only when the cart has alcohol
    optional(membership.discount(10)), // 10% off with a loyalty credential
    required(payment.in("usd")), // amount derived from the order; settles last
  ]),
);

const { url } = await store.listen(Number(process.env.PORT ?? 3005));
console.log(`\n  ✓ AttestoMCP storefront running → ${url}`);
console.log(`  persistence : ${storage ? `Redis (namespace "${namespace}")` : "IN-MEMORY — set KV_REST_API_URL/TOKEN for Redis"}`);
console.log(`  walletOrigin: ${walletOrigin ?? "(unset — set WALLET_ORIGIN to your public https origin)"}`);
console.log(`  next: expose it (cloudflared tunnel --url ${url.replace("/mcp", "")}) and add <public>/mcp to Claude.\n`);
