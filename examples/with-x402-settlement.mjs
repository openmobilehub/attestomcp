// A credential-gated storefront whose payment SETTLES on-chain via x402 — the `settle` seam.
//
//   npm run build:packages                  # build the two @openmobilehub/attestomcp-* packages
//   node examples/with-x402-settlement.mjs   # → http://localhost:3007/mcp
//
// `createStorefront({ settle })` threads an optional settlement function into the gate's
// shared completeOrder: once the four payment gates pass, `settle(order)` runs and its
// record rides along on the completion — shown on the receipt and in get-order-status.
//
// Settlement GATES completion (fail-closed): if `settle` THROWS, NOTHING is recorded and
// the cart stays intact (authorized-but-not-settled), so a flaky chain never marks an
// order paid. The amount is ALWAYS re-derived server-side from the order (completeOrder
// has already re-priced it against the catalog) — never a client-supplied figure.
//
// `settle` here is a MOCK so the example runs with no credentials. The commented block
// below is the REAL Hedera/x402 wiring the reference demo uses (a fresh session wallet
// per order, settled through the blocky402 facilitator on Hedera testnet).

import { createStorefront } from "@openmobilehub/attestomcp-storefront/server";
import { AttestoMcp, age, membership, payment, required, optional } from "@openmobilehub/attestomcp-gate";

// ── the settlement seam ──────────────────────────────────────────────────────
// Return any record with at least { network, txId, status }; the receipt renders
// whatever extra fields you provide (amount, payer, an explorer link, …).
const settle = async (order) => {
  const amountTinybar = Math.round(order.total * 1e4); // demo peg: 1 USD ≈ 0.0001 ℏ
  const txId = `0.0.123456@${Math.floor(Date.now() / 1000)}.000000000`;
  return {
    network: "hedera-testnet",
    status: "settled",
    txId,
    amountTinybar,
    fxRate: "1 USD = 0.0001 HBAR (demo peg)",
    payer: { accountId: "0.0.123456", kind: "session-wallet" },
    payTo: "0.0.654321",
    settledInMs: 1200,
    walletAgeMs: 1200,
    hashscanUrl: `https://hashscan.io/testnet/transaction/${encodeURIComponent(txId)}`,
  };
};

// The REAL on-chain wiring (the reference demo) — uncomment and provide HEDERA_* env
// (HEDERA_OPERATOR_ID/KEY, HEDERA_MERCHANT_ACCOUNT_ID; optional HEDERA_CUSTOMER_ID/KEY):
//
//   import { settleOrder } from "../payment-gate/hedera-settlement/settle.js";
//   import { hederaSettlementConfig } from "../payment-gate/hedera-settlement/config.js";
//   const hedera = hederaSettlementConfig(process.env);          // null unless HEDERA_* set
//   const settle = hedera ? (order) => settleOrder(order, hedera) : undefined;

const store = createStorefront({ settle, signingKey: process.env.GATE_SECRET });
const attestomcp = new AttestoMcp();
attestomcp.mount(store.app); // wires the /attestomcp/* ceremony rails; payment completes through completeOrder → settle

const hasAlcohol = (order) => order.lines.some((l) => l.minimumAge != null);
store.gate((order) =>
  attestomcp.requirements(order, [
    required(age.over(21).when(hasAlcohol)),
    optional(membership.discount(10)),
    required(payment.in("usd")), // amount derived from the order; settles LAST, then `settle` runs
  ]),
);

const { url } = await store.listen(Number(process.env.PORT ?? 3007));
console.log(`\n  ✓ AttestoMcp storefront with x402 settlement → ${url}`);
console.log(`  Buy the whiskey → prove age → authorize payment; the receipt shows the on-chain settlement record.`);
console.log(`  (Throw inside settle() to see fail-closed completion: nothing is recorded, the cart stays intact.)\n`);
