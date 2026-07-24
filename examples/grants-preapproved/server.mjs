// Runnable example — approve a spending limit once, let the agent buy against it later,
// built on the real credentagent.grants API (spec 009, the human-not-present half).
//
//   node examples/grants-preapproved/server.mjs   # boots on http://localhost:4000
//   node examples/grants-preapproved/smoke.mjs    # drives the whole flow + asserts (no browser)
//
// The human approves ONE limit at the grant's approveUrl; the agent then spends against it
// unattended. Every spend is re-priced from the server-side catalog (never a caller amount),
// capped per-purchase and in total, safely retryable by idempotency key, and revocable.
// Honesty: trust is `server-issued-demo` — no real value moves, and age-restricted items
// NEVER complete on autopilot (they step up to a live human).
import express from "express";
import { CredentAgent, usd, age, required } from "@openmobilehub/credentagent-gate";

const PORT = 4000;
const app = express();
app.use(express.json());

// ── ONCE, at startup ────────────────────────────────────────────────────────────
// The catalog is the price authority (a spend names a sku, never an amount).
const credentagent = new CredentAgent({
  walletOrigin: `http://localhost:${PORT}`,
  catalog: { coffee: 4.5, beans: 14, "case-of-beans": 40, wine: { price: 21, minAge: 21 } },
});
credentagent.grants.serve(app);                    // the approve page at each grant's approveUrl
credentagent.on("order.settled", ({ id }) => console.log(`✓ spend settled: ${id}`));

// ── The agent asks for authority — gets back a link to hand to the human ─────────
app.post("/setup-coffee-fund", async (_req, res) => {
  const grant = await credentagent.grants.create({
    merchant: "corner-cafe",
    budget: usd.dollars(50),
    perSpend: usd.dollars(15),
    policy: [],
    description: "Coffee while I'm heads-down this week",
  });
  res.json({ id: grant.id, approveUrl: grant.approveUrl, status: grant.status });
});

// A grant whose policy needs a credential — demo-approve is fenced for it (403).
app.post("/setup-wine-fund", async (_req, res) => {
  const grant = await credentagent.grants.create({
    merchant: "corner-cafe",
    budget: usd.dollars(50),
    perSpend: usd.dollars(30),
    policy: [required(age.over(21))],
  });
  res.json({ id: grant.id, approveUrl: grant.approveUrl, status: grant.status });
});

// ── LATER — human away — the agent spends against the grant ─────────────────────
app.post("/buy/:grantId", async (req, res) => {
  const grant = await credentagent.grants.retrieve(req.params.grantId);
  if (grant.status !== "authorized") {
    res.status(409).json({ status: grant.status, approveUrl: grant.approveUrl });
    return;
  }
  const s = await grant.spend({
    idempotencyKey: req.body.purchaseId,           // REUSE on retry — never double-charges
    items: [{ sku: req.body.sku, qty: req.body.qty ?? 1 }],
  });
  const body = s.ok
    ? { ok: true, amount: s.amount.serialize(), remaining: s.remaining.serialize(), replayed: s.replayed ?? false }
    : { ok: false, code: s.code, retryable: s.retryable, remaining: s.remaining.serialize() };
  res.status(s.ok ? 200 : 402).json(body);
});

// The kill switch.
app.delete("/grants/:grantId", async (req, res) => {
  const grant = await credentagent.grants.retrieve(req.params.grantId);
  await grant.revoke();
  res.json({ status: "revoked" });
});

app.listen(PORT, () => {
  console.log(`grants-preapproved example on http://localhost:${PORT}`);
  console.log(`  1) POST /setup-coffee-fund              → { id, approveUrl }`);
  console.log(`  2) open the approveUrl → Approve         (the one human step)`);
  console.log(`  3) POST /buy/<id> {"purchaseId":"p1","sku":"coffee"}  → spends, unattended`);
  console.log(`  4) DELETE /grants/<id>                  → revoked; the next spend refuses`);
});
