// Smoke test for the grants-preapproved example — drives the REAL built package over HTTP
// and asserts, so CI (and you) can prove the pre-approved spending flow end-to-end without
// a browser. Covers the security-critical shapes:
//   • a spend BEFORE approval is refused (pending, never ok);
//   • a policy-GATED grant cannot be approved from the demo button (403, fail-closed);
//   • spends are capped per-purchase and in total; a retry with the same purchaseId is
//     answered once-charged (replayed), age-restricted items step up, revoke kills the grant.
import express from "express";
import { CredentAgent, usd, age, required } from "@openmobilehub/credentagent-gate";

const app = express();
app.use(express.json());

const settled = [];
const ca = new CredentAgent({
  walletOrigin: "http://localhost:0",
  catalog: { coffee: 4.5, beans: 14, "case-of-beans": 40, wine: { price: 21, minAge: 21 } },
});
ca.grants.serve(app);
ca.on("order.settled", ({ id }) => settled.push(id));

app.post("/setup", async (req, res) =>
  res.json(
    await (async () => {
      const g = await ca.grants.create({
        merchant: "corner-cafe",
        budget: usd.dollars(50),
        perSpend: usd.dollars(15),
        policy: req.body?.gated ? [required(age.over(21))] : [],
      });
      return { id: g.id, approveUrl: g.approveUrl, status: g.status };
    })(),
  ),
);
app.post("/buy/:id", async (req, res) => {
  const grant = await ca.grants.retrieve(req.params.id);
  if (grant.status !== "authorized") { res.status(409).json({ status: grant.status }); return; }
  const s = await grant.spend({ idempotencyKey: req.body.purchaseId, items: [{ sku: req.body.sku }] });
  res.status(s.ok ? 200 : 402).json(s.ok
    ? { ok: true, amount: s.amount.serialize(), remaining: s.remaining.serialize(), replayed: s.replayed ?? false }
    : { ok: false, code: s.code, remaining: s.remaining.serialize() });
});
app.delete("/grants/:id", async (req, res) => { await (await ca.grants.retrieve(req.params.id)).revoke(); res.json({}); });

let failures = 0;
const check = (label, cond) => { console.log(`${cond ? "✓" : "✗"} ${label}`); if (!cond) failures++; };

const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
const base = `http://localhost:${server.address().port}`;
const j = async (r) => ({ status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text() });
const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

try {
  // ── the pending lifecycle ──
  const g = (await j(await post("/setup"))).body;
  check("create returns a pending grant with an approveUrl", g.id.startsWith("gr_") && g.status === "pending" && g.approveUrl.includes(g.id));

  const early = await j(await post(`/buy/${g.id}`, { purchaseId: "p0", sku: "coffee" }));
  check("a spend BEFORE approval is refused (never ok unapproved)", early.status === 409 && early.body.status === "pending");

  const page = await j(await fetch(`${base}/credentagent/grants/${g.id}`));
  check("the approve page renders the terms", page.status === 200 && page.body.includes("$50.00") && page.body.includes("corner-cafe"));

  await post(`/credentagent/grants/${g.id}/approve`);
  const st = (await j(await fetch(`${base}/credentagent/grants/${g.id}/status`))).body;
  check("approve flips the grant to authorized", st.completed === true && st.status === "authorized");

  // ── spending, capped + replayable ──
  const s1 = (await j(await post(`/buy/${g.id}`, { purchaseId: "p1", sku: "coffee" }))).body;
  check("a spend is priced by the catalog and draws down the budget ($4.50 → $45.50 left)", s1.ok && s1.amount.amount === 450 && s1.remaining.amount === 4550);

  const retry = (await j(await post(`/buy/${g.id}`, { purchaseId: "p1", sku: "coffee" }))).body;
  check("retrying the SAME purchaseId replays once-charged (remaining unchanged)", retry.ok && retry.replayed === true && retry.remaining.amount === 4550);

  const over = await j(await post(`/buy/${g.id}`, { purchaseId: "p2", sku: "case-of-beans" }));
  check("a single spend over the per-purchase cap is refused (per-spend-exceeded)", over.status === 402 && over.body.code === "per-spend-exceeded");

  const wine = await j(await post(`/buy/${g.id}`, { purchaseId: "p3", sku: "wine" }));
  check("an age-restricted item NEVER completes on autopilot (step-up)", wine.status === 402 && wine.body.code === "step-up");

  await post(`/buy/${g.id}`, { purchaseId: "p4", sku: "beans" });   // 14.00 → 31.50 left
  await post(`/buy/${g.id}`, { purchaseId: "p5", sku: "beans" });   // 14.00 → 17.50 left
  await post(`/buy/${g.id}`, { purchaseId: "p6", sku: "beans" });   // 14.00 →  3.50 left
  const broke = await j(await post(`/buy/${g.id}`, { purchaseId: "p7", sku: "beans" }));
  check("a spend beyond the cumulative budget is refused (budget-exceeded)", broke.status === 402 && broke.body.code === "budget-exceeded" && broke.body.remaining.amount === 350);

  check("order.settled fired once per completed spend (4 spends)", settled.length === 4 && settled.every((id) => id.startsWith(`${g.id}-`)));

  // ── the kill switch ──
  await fetch(`${base}/grants/${g.id}`, { method: "DELETE" });
  const dead = await j(await post(`/buy/${g.id}`, { purchaseId: "p8", sku: "coffee" }));
  check("after revoke, the very next spend is refused", dead.status === 409 || dead.body.code === "revoked");

  // ── the fence: a policy-gated grant can't be button-approved ──
  const gated = (await j(await post("/setup", { gated: true }))).body;
  const fenced = await j(await post(`/credentagent/grants/${gated.id}/approve`));
  check("a policy-gated grant is REFUSED on the demo approve path (403)", fenced.status === 403);
  const gatedSt = (await j(await fetch(`${base}/credentagent/grants/${gated.id}/status`))).body;
  check("…and it stays pending (nothing sealed)", gatedSt.completed === false && gatedSt.status === "pending");
} finally {
  server.close();
}

console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
