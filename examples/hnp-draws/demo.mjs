// See the HNP "doorman" (PR #41) in action — no web page needed.
// The user pre-approves ONCE (one Intent Mandate). Then the agent makes several
// purchases (draws) AGAINST THAT ONE PRE-APPROVAL, and the gate decides each. Run:
//   node examples/hnp-draws/demo.mjs
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

// Merchant scope uses CANONICAL MACHINE IDS (a domain here), never display names.
// The scope check is an exact match, so "blue-bottle.example" is an identifier — not
// the brand "Blue Bottle" — and it must be identical on the mandate and every draw.
const BLUE_BOTTLE = "blue-bottle.example";
const STARBUCKS = "starbucks.example";

// ── STEP 1: the user pre-approves ONCE (the phone ceremony, faked here) ───────
const { privateKey, delegate } = await generateDelegate();
const intent = await sealIntent({
  type: "credentagent.IntentBounds/v0",
  naturalLanguageDescription: "Reorder Blue Bottle coffee, up to $40 total, this month",
  merchants: [BLUE_BOTTLE],
  currency: "USD",
  maxAmount: 40, // per-purchase ceiling
  totalAmount: 40, // cumulative ceiling across ALL draws
  stepUpOver: 500,
  intentExpiry: "2026-07-31T23:59:59Z",
  delegate,
  mayPresent: [],
  presence: "delegated-demo",
  trust_level: "server-issued-demo",
});
console.log(`\n🎫  ONE pre-approval minted (an Intent Mandate):`);
console.log(`    "${intent.naturalLanguageDescription}"`);
console.log(`    id ${intent.intentId.slice(0, 22)}…  ·  presence=${intent.presence}  trust=${intent.trust_level}`);
console.log(`\n    Every purchase below is a DRAW against this one pre-approval —`);
console.log(`    tx_1, tx_2, … are transaction ids (like check numbers), not separate approvals.\n`);

// shared server-side state (revocation + single-use ledger, per-order verification).
// ONE store for the whole run, so draws see each other's history.
const revocation = new MemoryRevocationStore();
const verificationStore = new MemoryVerificationStore();
const records = new Map();
const ctx = { catalog, verificationStore, revocation, records: { read: (id) => records.get(id), write: (r) => records.set(r.orderId, r) } };

let n = 0;
// Each call is ONE draw against the shared `intent` above.
async function draw(label, { items, merchant, amount, pspTransactionId }) {
  const order = catalog.createOrder(items, `ORD-${++n}`);
  const signed = await signDraw({ type: "credentagent.Draw/v0", intentId: intent.intentId, paymentMandateId: `d${n}`, merchant, amount, currency: "USD", pspTransactionId }, privateKey);
  const res = await completeOrder({ order, mandateId: signed.paymentMandateId, amount, currency: "USD", method: "delegated", gates: [{ gate: "draw", pass: true, detail: "" }], draw: { intent, draw: signed } }, ctx);
  const tag = `[${pspTransactionId}] ${label}`;
  if (res.completed) console.log(`✅  ${tag}\n     → COMPLETED (delegationId ${res.delegationId.slice(0, 18)}… · no real money moved)\n`);
  else console.log(`⛔  ${tag}\n     → REFUSED: ${res.refusals.map((r) => r.code).join(", ")}\n`);
}

console.log("─".repeat(70));
console.log("STEP 2: the agent makes draws against that ONE pre-approval\n");
await draw("reorder 1 bag of coffee ($18) from blue-bottle", { items: [{ productId: "coffee", quantity: 1 }], merchant: BLUE_BOTTLE, amount: 18, pspTransactionId: "tx_1" });
await draw("re-submit tx_1 — the SAME transaction again (double-spend)", { items: [{ productId: "coffee", quantity: 1 }], merchant: BLUE_BOTTLE, amount: 18, pspTransactionId: "tx_1" });
await draw("a $54 cart — 3 bags — over the $40 cap", { items: [{ productId: "coffee", quantity: 3 }], merchant: BLUE_BOTTLE, amount: 54, pspTransactionId: "tx_2" });
await draw("a purchase at a DIFFERENT store (starbucks, not approved)", { items: [{ productId: "coffee", quantity: 1 }], merchant: STARBUCKS, amount: 18, pspTransactionId: "tx_3" });
await draw("buy WINE (age-restricted) on this coffee pre-approval", { items: [{ productId: "wine", quantity: 1 }], merchant: BLUE_BOTTLE, amount: 20, pspTransactionId: "tx_4" });

console.log("🔴  STEP 3: you revoke the pre-approval from your phone…\n");
revocation.revoke(intent.intentId);
await draw("another coffee reorder, after revocation", { items: [{ productId: "coffee", quantity: 1 }], merchant: BLUE_BOTTLE, amount: 18, pspTransactionId: "tx_5" });
console.log("─".repeat(70));
console.log("\nThe doorman: 1 legit draw through, 5 refused with reasons, 0 real money moved.\n");
