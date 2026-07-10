// CredentAgent — a pre-approval your AI agent can spend against, but can't abuse.
//
// You approve ONCE on your phone ("reorder my coffee, up to $30 an order"). Your
// agent then shops on its own while you sleep — but it never holds a blank cheque:
// the gate re-checks EVERY purchase against your limits and refuses any that breaks
// them, in plain English. Change your mind? Revoke, and the next one dies.
//
// It's a demo grant — no real money moves. Run it:  node examples/hnp-draws/demo.mjs

// ═════════════════════════════════════════════════════════════════════════════
//  THE WHOLE POINT — reads top-to-bottom like plain English. (Plumbing is below.)
// ═════════════════════════════════════════════════════════════════════════════
async function story() {
  // 1 — Pre-approve once, in plain words. Then go to sleep. 😴
  const agent = await preApprove("Reorder coffee from Blue Bottle — up to $30 an order.", {
    store: BLUE_BOTTLE,
    perOrder: 30, // never a single order over $30
    perMonth: 100, //  ...and no more than $100 all month
  });

  // 2 — Your agent shops on its own. Every field is named, so each line says what it is.
  //     The gate re-checks each purchase against your limits:
  await agent.buy({ charge: "c1", item: "coffee" });                    // ✅  within your rules
  await agent.buy({ charge: "c1", item: "coffee" });                    // ⛔  same charge id — sent twice
  await agent.buy({ charge: "c2", item: "coffee", quantity: 3 });       // ⛔  $54 — over your $30 cap
  await agent.buy({ charge: "c3", item: "coffee", store: STARBUCKS });  // ⛔  a store you never approved
  await agent.buy({ charge: "c4", item: "wine" });                      // ⛔  age-restricted

  // 3 — You change your mind and revoke from your phone.
  agent.revoke();
  await agent.buy({ charge: "c5", item: "coffee" });                    // ⛔  too late — the grant is dead
}

// ═════════════════════════════════════════════════════════════════════════════
//  PLUMBING — the real @openmobilehub/credentagent-gate API, wired once. Skip on a
//  first read: the two helpers the story uses (preApprove + buy) are defined here.
// ═════════════════════════════════════════════════════════════════════════════
import {
  sealIntent, generateDelegate, signDraw, completeOrder,
  MemoryRevocationStore, MemoryVerificationStore,
} from "@openmobilehub/credentagent-gate";

// A pretend shop. Merchant scope matches on a machine id (a domain), not a brand name.
const BLUE_BOTTLE = "blue-bottle.example";
const STARBUCKS = "starbucks.example";
const PRICES = { coffee: { price: 18 }, wine: { price: 20, minimumAge: 21 } };
const catalog = {
  createOrder(items, orderId) {
    const lines = items.map(({ productId, quantity }) => {
      const p = PRICES[productId];
      return { id: productId, name: productId, unitPrice: p.price, currency: "USD", quantity,
        lineTotal: p.price * quantity, ...(p.minimumAge ? { minimumAge: p.minimumAge } : {}) };
    });
    const total = lines.reduce((s, l) => s + l.lineTotal, 0);
    return { id: orderId, lines, itemCount: items.length, subtotal: total, discount: 0, total, currency: "USD", createdAt: new Date().toISOString() };
  },
};

// The gate keeps only a small ledger (what's revoked / already drawn) + per-order state.
// It does NOT store your pre-approval — the agent re-presents it on every single purchase.
const ledger = new MemoryRevocationStore();
const records = new Map();
const gate = {
  catalog,
  revocation: ledger,
  verificationStore: new MemoryVerificationStore(),
  records: { read: (id) => records.get(id), write: (r) => records.set(r.orderId, r) },
};

// The gate returns terse codes; we humanize them so the output reads like the intent.
const WHY = {
  replay: "the same charge, twice",
  "over-cap": "over your per-order cap",
  "over-total": "over your monthly cap",
  "out-of-scope": "a store you never approved",
  "step-up": "age-restricted — needs you there in person",
  revoked: "you revoked this grant",
};
const tally = { ok: 0, no: 0 };
let orderSeq = 0;

// preApprove — mint ONE grant (your intent + a delegate key), hand it to your agent.
async function preApprove(sentence, { store, perOrder, perMonth }) {
  const { privateKey, delegate } = await generateDelegate();
  const mandate = await sealIntent({
    type: "credentagent.IntentBounds/v0",
    naturalLanguageDescription: sentence,
    merchants: [store], currency: "USD",
    maxAmount: perOrder, totalAmount: perMonth,
    delegate, mayPresent: [],
    presence: "delegated-demo", trust_level: "server-issued-demo",
  });
  console.log(`\n🎫  You pre-approved once:  “${sentence}”`);
  console.log(`    Your agent now holds it; the gate stores nothing. Off to sleep. 😴\n`);
  return {
    buy: (purchase) => buy(mandate, privateKey, purchase),
    revoke: () => { ledger.revoke(mandate.intentId); console.log(`\n🔴  You revoked the grant from your phone.\n`); },
  };
}

// buy — your agent signs ONE draw against the grant it holds, presents { grant, draw }
// to the gate, and we print the verdict. Amount is derived from the catalog, never trusted.
// `charge` is the payment's transaction id: reuse one and the gate sees a double-spend.
async function buy(mandate, key, { charge, item, quantity = 1, store = mandate.merchants[0] }) {
  const order = catalog.createOrder([{ productId: item, quantity }], `ORD-${++orderSeq}`);
  const draw = await signDraw(
    { type: "credentagent.Draw/v0", intentId: mandate.intentId, paymentMandateId: charge,
      merchant: store, amount: order.total, currency: "USD", pspTransactionId: charge },
    key,
  );
  const res = await completeOrder(
    { order, mandateId: charge, amount: order.total, currency: "USD", method: "delegated",
      gates: [{ gate: "draw", pass: true, detail: "" }], draw: { intent: mandate, draw } },
    gate,
  );
  const what = `${quantity} ${item} @ ${store.split(".")[0]}`.padEnd(22);
  if (res.completed) { tally.ok++; console.log(`  ✅  ${charge}  ${what}  approved — $${order.total} (no real money moved)`); }
  else { tally.no++; const code = res.refusals[0].code; console.log(`  ⛔  ${charge}  ${what}  refused — ${WHY[code] ?? code}`); }
}

await story();
console.log(`\n  ${tally.ok} purchase through · ${tally.no} refused, each with a reason · $0 real money moved.\n`);
