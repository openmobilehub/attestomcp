// Smoke — the executable form of specs/007-quickstart-ladder/contracts/quickstart-surface.md.
//
//   npm run smoke                        # spawns server.mjs (stateless mode) and asserts a–e
//   SMOKE_URL=https://… npm run smoke    # same assertions against a deployed URL
//
// Every assertion is security-bearing: each fails when its control is removed.
import { spawn, spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.env.SMOKE_PORT ?? 3999);
const external = process.env.SMOKE_URL?.replace(/\/$/, "");
const base = external ?? `http://localhost:${PORT}`;
let child, failures = 0;

const ok = (label, cond, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${cond ? "" : `  ← FAILED ${detail}`}`);
  if (!cond) failures++;
};
const tamper = (cart) => {
  const m = JSON.parse(Buffer.from(cart, "base64url").toString());
  m.lines[0].quantity += 9; // price a 1-qty order, pay for 10 — must be refused
  m.lines[0].lineTotal = m.lines[0].unitPrice * m.lines[0].quantity;
  return Buffer.from(JSON.stringify(m)).toString("base64url");
};
const placeOrder = (order, cart) =>
  fetch(`${base}/checkout/place-order`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ order, ...(cart ? { cart } : {}) }),
  });
const completed = async (orderId) =>
  (await (await fetch(`${base}/checkout/order-status?orderId=${orderId}`)).json()).completed;

if (!external) {
  // Boot-refusal probe (US3.3): deployed mode without GATE_SECRET must fail fast.
  const env = { ...process.env, VERCEL: "1", PORT: String(PORT) };
  delete env.GATE_SECRET; delete env.VERCEL_PROJECT_PRODUCTION_URL;
  delete env.KV_REST_API_URL; delete env.KV_REST_API_TOKEN;
  delete env.UPSTASH_REDIS_REST_URL; delete env.UPSTASH_REDIS_REST_TOKEN;
  const probe = spawnSync("node", ["server.mjs"], { env, timeout: 10_000, encoding: "utf8" });
  ok("boot refuses without GATE_SECRET (deployed mode)", probe.status !== 0 && /GATE_SECRET/.test(probe.stderr));

  // Real run: deployed-mode semantics (statelessOrders) on localhost.
  child = spawn("node", ["server.mjs"], { env: { ...env, GATE_SECRET: "quickstart-smoke-secret" }, stdio: ["ignore", "pipe", "inherit"] });
  for (let i = 0; ; i++) {
    try { await fetch(`${base}/checkout/order-status?orderId=probe`); break; }
    catch { if (i > 60) { console.error("server never came up"); process.exit(1); } await new Promise((r) => setTimeout(r, 250)); }
  }
}

try {
  // (a) MCP initialize handshake
  const mcp = new Client({ name: "quickstart-smoke", version: "0.0.0" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  ok("(a) MCP initialize handshake", true);

  // (g) the widget bundle actually loads — the ui:// resource read must return HTML,
  // not "widget bundle not found". A Node client calling tools never exercises this, so
  // a missing bundle (e.g. not in the serverless includeFiles) slips past every other
  // assertion; this is the one that catches it.
  try {
    const list = await mcp.listResources();
    const ui = list.resources.find((r) => r.uri.startsWith("ui://"));
    const doc = ui ? await mcp.readResource({ uri: ui.uri }) : null;
    const html = doc?.contents?.[0]?.text ?? "";
    ok("(g) widget ui:// resource loads (HTML bundle present)", !!ui && html.includes("<") && html.length > 1000, `uri=${ui?.uri} len=${html.length}`);
  } catch (e) {
    ok("(g) widget ui:// resource loads (HTML bundle present)", false, e.message.slice(0, 80));
  }

  const checkout = async (items) => {
    const r = await mcp.callTool({ name: "checkout", arguments: { items } });
    const sc = r.structuredContent ?? {};
    return { ...sc, cart: sc.checkoutUrl ? new URL(sc.checkoutUrl).searchParams.get("cart") : null };
  };

  // (b) whiskey → age gate in the requires manifest, payment last
  const gated = await checkout([{ productId: "oak-whiskey", quantity: 1 }]);
  const ageReq = (gated.requires ?? []).find((e) => e.credential === "age");
  ok("(b) whiskey checkout requires age 21+ (required, payment last)",
    !!ageReq && ageReq.required === true && ageReq.minAge === 21 &&
    gated.requires.at(-1)?.credential === "payment", JSON.stringify(gated.requires));

  // (c) headphones → no age entry
  const ungated = await checkout([{ productId: "aurora-headphones", quantity: 1 }]);
  ok("(c) headphones checkout has no age requirement",
    !(ungated.requires ?? []).some((e) => e.credential === "age"), JSON.stringify(ungated.requires));

  const CLAIMS = { issuer_name: "Demo Bank", payment_instrument_id: "pi-SMOKE", holder_name: "Smoke Buyer", expiry_date: "2032-09-01" };
  const railVerify = (order, cartB64) =>
    fetch(`${base}/credentagent/dc-payment/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ order, cartMandate: JSON.parse(Buffer.from(cartB64, "base64url").toString()), claims: CLAIMS }),
    }).then((r) => r.json());

  // (d) unverified completion of a GATED order → refused server-side (403)
  const d = await placeOrder(gated.orderId, gated.cart);
  ok("(d) unverified place-order of gated order → 403", d.status === 403, `got ${d.status}`);
  ok("(d′) gated order stays incomplete", (await completed(gated.orderId)) === false);

  // (f) enforce on EVERY completion path: paying for an age-gated order whose age is
  // still unverified must be refused by the payment rail itself, with the typed reason.
  if (gated.cart) {
    const f = await railVerify(gated.orderId, gated.cart);
    ok("(f) payment-only verify of age-gated order → refused (reason: age)",
      f.completed !== true && f.reason === "age" && (await completed(gated.orderId)) === false, JSON.stringify(f));
  }

  // (e) the payment rail: tampered cart mandate refused, untampered completes.
  // (place-order is the wrong door here — every quickstart order requires payment, so (d)
  // proves that path always 403s; stateless completion happens on the dc-payment rail.)
  const victim = await checkout([{ productId: "aurora-headphones", quantity: 1 }]);
  const attacked = await checkout([{ productId: "aurora-headphones", quantity: 1 }]);
  if (victim.cart) {
    const refused = await railVerify(attacked.orderId, tamper(attacked.cart));
    ok("(e) tampered cart mandate → verify refused, order NOT completed",
      refused.completed !== true && (await completed(attacked.orderId)) === false, JSON.stringify(refused));
    const done = await railVerify(victim.orderId, victim.cart);
    ok("(e′) untampered mandate completes on the payment rail (stateless)",
      done.completed === true && (await completed(victim.orderId)) === true, JSON.stringify(done));
  } else {
    ok("(e) skipped — store mode (no cart param); run with statelessOrders for the tamper probe", true);
  }

  await mcp.close();
} catch (err) {
  console.error("smoke crashed:", err);
  failures++;
} finally {
  child?.kill();
}
console.log(failures ? `\n${failures} assertion(s) FAILED` : "\nsmoke green — contract holds");
process.exit(failures ? 1 : 0);
