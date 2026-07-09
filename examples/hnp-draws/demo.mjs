// See the HNP "doorman" (PR #41) in action — no web page needed.
// Mints a pre-approval (Intent Mandate), then throws good + bad purchases (draws)
// at completeOrder and prints what the gate decides. Run:
//   node examples/hnp-draws-demo.mjs
import {
  sealIntent,
  generateDelegate,
  signDraw,
  completeOrder,
  MemoryRevocationStore,
  MemoryVerificationStore,
} from "@openmobilehub/credentagent-gate";

// ── a tiny catalog: coffee $18, wine $20 (age-restricted) ────────────────────
const PRODUCTS = { coffee: { price: 18 }, wine: { price: 20, minimumAge: 21 } };
const catalog = {
  createOrder(items, orderId) {
    const lines = items.map((it) => {
      const p = PRODUCTS[it.productId];
      return { id: it.productId, name: it.productId, unitPrice: p.price, currency: "USD", quantity: it.quantity, lineTotal: p.price * it.quantity, ...(p.minimumAge ? { minimumAge: p.minimumAge } : {}) };
    });
    const total = lines.reduce((s, l) => s + l.lineTotal, 0);
    return { id: orderId, lines, itemCount: items.length, subtotal: total, discount: 0, total, currency: "USD", createdAt: new Date().toISOString() };
  },
};

// ── the user pre-approves ONCE (this is the phone ceremony, faked here) ───────
const { privateKey, delegate } = await generateDelegate();
const intent = await sealIntent({
  type: "credentagent.IntentBounds/v0",
  naturalLanguageDescription: "Reorder Blue Bottle coffee, up to $40, this month",
  merchants: ["blue-bottle"],
  currency: "USD",
  maxAmount: 40,
  totalAmount: 40,
  stepUpOver: 500,
  intentExpiry: "2026-07-31T23:59:59Z",
  delegate,
  mayPresent: [],
  presence: "delegated-demo",
  trust_level: "server-issued-demo",
});
console.log(`\n🎫  Pre-approval minted: "${intent.naturalLanguageDescription}"`);
console.log(`    id ${intent.intentId.slice(0, 22)}…  ·  presence=${intent.presence}  trust=${intent.trust_level}\n`);

// shared server-side state (revocations + single-use ledger, per-order verification)
const revocation = new MemoryRevocationStore();
const verificationStore = new MemoryVerificationStore();
const records = new Map();
const ctx = { catalog, verificationStore, revocation, records: { read: (id) => records.get(id), write: (r) => records.set(r.orderId, r) } };

let n = 0;
async function attempt(label, { items, merchant, amount, pspTransactionId, orderId }) {
  const order = catalog.createOrder(items, orderId ?? `ORD-${++n}`);
  const draw = await signDraw({ type: "credentagent.Draw/v0", intentId: intent.intentId, paymentMandateId: `d${n}`, merchant, amount, currency: "USD", pspTransactionId }, privateKey);
  const res = await completeOrder({ order, mandateId: draw.paymentMandateId, amount, currency: "USD", method: "delegated", gates: [{ gate: "draw", pass: true, detail: "" }], draw: { intent, draw } }, ctx);
  if (res.completed) console.log(`✅  ${label}\n     → COMPLETED, logged delegationId ${res.delegationId.slice(0, 18)}… (no real money moved)\n`);
  else console.log(`⛔  ${label}\n     → REFUSED: ${res.refusals.map((r) => r.code).join(", ")}\n`);
}

console.log("─".repeat(64));
await attempt("Agent reorders 1 bag of Blue Bottle coffee ($18)", { items: [{ productId: "coffee", quantity: 1 }], merchant: "blue-bottle", amount: 18, pspTransactionId: "tx_1" });
await attempt("Agent tries to reuse the SAME transaction (double-spend)", { items: [{ productId: "coffee", quantity: 1 }], merchant: "blue-bottle", amount: 18, pspTransactionId: "tx_1" });
await attempt("Agent tries a $54 cart — 3 bags, over the $40 cap", { items: [{ productId: "coffee", quantity: 3 }], merchant: "blue-bottle", amount: 54, pspTransactionId: "tx_2" });
await attempt("Agent tries a DIFFERENT store (Starbucks)", { items: [{ productId: "coffee", quantity: 1 }], merchant: "starbucks", amount: 18, pspTransactionId: "tx_3" });
await attempt("Agent tries to buy WINE on the coffee pre-approval", { items: [{ productId: "wine", quantity: 1 }], merchant: "blue-bottle", amount: 20, pspTransactionId: "tx_4" });

console.log("🔴  You revoke the pre-approval from your phone…\n");
revocation.revoke(intent.intentId);
await attempt("Agent tries another coffee reorder after revocation", { items: [{ productId: "coffee", quantity: 1 }], merchant: "blue-bottle", amount: 18, pspTransactionId: "tx_5" });
console.log("─".repeat(64));
console.log("\nThe doorman: 1 legit purchase through, 5 refused with reasons, 0 real money moved.\n");
