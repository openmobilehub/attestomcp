// CredentAgent — a pre-approval your AI agent can spend against, but can't abuse.
//
// You pre-approve ONCE; your agent then shops on its own while you sleep. It never holds a
// blank cheque — every purchase is re-checked against your limits and refused if it breaks
// one, in plain terms. Revoke and the next one dies. A demo — no real money moves.
//   Run:  node examples/hnp-draws/demo.mjs
import { DelegatedGate } from "@openmobilehub/credentagent-gate";

// 1. Configure the gate once with your priced catalog.  (Like `new Stripe(key)`.)
const gate = new DelegatedGate({
  catalog: { coffee: 18, wine: { price: 20, minAge: 21 } },
});

// 2. Pre-approve once. Your agent holds the returned grant and shops while you sleep. 😴
const grant = await gate.preApprove({
  merchant: "blue-bottle",
  perOrder: 30, // no single order over $30
  total: 100, //  and $100 total before the grant is spent out
});
console.log("\n🎫  Pre-approved: coffee at blue-bottle, up to $30/order. Off to sleep. 😴\n");

// 3. Your agent spends against it. Each spend() returns { ok, amount, reason? } — no throwing.
await show("1 coffee", { paymentId: "c1", item: "coffee" });
await show("the same payment again", { paymentId: "c1", item: "coffee" });
await show("3 coffees at once", { paymentId: "c2", item: "coffee", quantity: 3 });
await show("coffee — different store", { paymentId: "c3", item: "coffee", merchant: "starbucks" });
await show("wine — age-restricted", { paymentId: "c4", item: "wine" });
await grant.revoke(); // you change your mind, from your phone
await show("1 coffee — after revoke", { paymentId: "c5", item: "coffee" });

// Pretty-print one spend (demo output only — not part of the API).
async function show(label, purchase) {
  const { ok, amount, reason } = await grant.spend(purchase);
  const verdict = ok ? "approved (no real money moved)" : `refused — ${reason}`;
  console.log(`  ${ok ? "✅" : "⛔"}  ${label.padEnd(24)} $${String(amount).padStart(2)}   ${verdict}`);
}
