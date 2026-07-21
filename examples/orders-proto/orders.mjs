// orders.mjs — a RUNNABLE prototype of the v10 `orders.*` surface (#92 / spec 008).
//
// This is a facade: it implements the DESIGNED shape (orders.create / orders.retrieve /
// orders.gate, the one { ok | pending | code } door, Money-as-type, trustLevel on every
// branch, the "order.settled" webhook) over an in-memory store + the REAL policy builders
// from @openmobilehub/credentagent-gate. The prove step is demo-approved here; the package
// version delegates manifest resolution to requirements() and the ceremony to mount().
//
// The point: make the new DX tangible and clickable, and prove the facade sits cleanly on
// the real primitives — not to ship this file.

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// ── Money — opaque, comparable (v10 FR-005) ────────────────────────
export function usd(minor) {
  return Object.freeze({
    currency: "usd",
    lt(o) { return minor < o._minor; },
    gte(o) { return minor >= o._minor; },
    eq(o) { return minor === o._minor; },
    serialize() { return { amount: minor, currency: "usd" }; },
    toString() { return `$${(minor / 100).toFixed(2)}`; },
    get _minor() { return minor; },
  });
}
usd.dollars = (d) => usd(Math.round(d * 100));
usd.cents = (c) => usd(c);

// ── the demo mandate bundle (real SHAPE; dev-sealed, presence-only-demo) ──
function mandateBundleFor(order, authorization) {
  const seal = (type) => ({
    type,
    trustLevel: "presence-only-demo",
    signature: { alg: "MOCK-DEV-SIGNER", note: "dev-sealed integrity hash — not key/issuer-signed" },
    serialize() { return { type, trust_level: "presence-only-demo", authorization, order: order.id }; },
  });
  return {
    // Intent Mandate is a grants-only artifact (FR-010) — absent on a human-present order:
    intentMandate: undefined,
    cartMandate: { ...seal("ap2.CartMandate"), lines: order.items },
    paymentMandate: { ...seal("ap2.PaymentMandate"), amount: order.total.serialize(), presenceMode: authorization === "delegated" ? "human_not_present" : "human_present" },
    trustLevel: "presence-only-demo",
  };
}

// ── the facade ─────────────────────────────────────────────────────
export class CredentAgentProto {
  constructor({ origin, catalog }) {
    this.origin = origin;
    this.catalog = catalog;
    this._orders = new Map();
    this._events = new EventEmitter();
    this.orders = {
      // orders.create({ order, policy }) → { id, approveUrl, manifest }  (mint, not the door)
      create: ({ order, policy }) => {
        const id = `ord_${randomUUID().slice(0, 8)}`;
        const total = this._price(order.items);          // re-priced from catalog — no amount is ever trusted
        const rec = { id, items: order.items, total, policy, state: "pending" };
        this._orders.set(id, rec);
        return { id, approveUrl: `${this.origin}/prove/${id}`, manifest: this._manifest(policy) };
      },
      // orders.retrieve(id) → the DOOR  (single read; use in a webhook handler, never a poll loop)
      retrieve: (id) => this._door(this._orders.get(id)),
    };
  }

  // orders.gate(handler, { order, policy }) — page-less wrapper; its RETURN is the door
  gate(handler, { policy }) {
    return async (args) => {
      const existing = args.__orderId && this._orders.get(args.__orderId);
      if (existing && existing.state === "verified") return { ok: true, structuredContent: await handler(args), mandateBundle: existing.bundle, trustLevel: "presence-only-demo" };
      const { id, approveUrl } = this.orders.create({ order: { items: args.items ?? [] }, policy });
      return { ok: false, pending: true, approveUrl, resume: args.__tool ?? "tool", trustLevel: "presence-only-demo" };
    };
  }

  // credentagent.on("order.settled", handler) — the webhook (FR-009)
  on(event, handler) { this._events.on(event, handler); }

  // DEMO prove — stands in for the wallet ceremony; marks verified, seals the bundle, fires the webhook
  _demoProve(id, { pass = true, failCode = "under-age", failCredential = "age" } = {}) {
    const rec = this._orders.get(id);
    if (!rec) return { ok: false, code: "not-found" };
    if (pass) {
      rec.state = "verified";
      rec.authorization = "direct";
      rec.bundle = mandateBundleFor(rec, "direct");
    } else {
      rec.state = "refused"; rec.code = failCode; rec.credential = failCredential;
    }
    this._events.emit("order.settled", { id });
    return this._door(rec);
  }

  _price(items) {
    let minor = 0;
    for (const { sku, qty } of items) {
      const entry = this.catalog[sku];
      if (!entry) throw new Error(`unknown sku: ${sku}`);
      minor += entry._minor * (qty ?? 1);
    }
    return usd(minor);
  }

  _manifest(policy) {
    return policy.map((step) => {
      const c = step.credential ?? step;               // required(x) wraps a credential; tolerate either
      return {
        credential: c.id ?? "credential",
        required: step.required !== false,
        label: c.ui?.label ?? c.id ?? "credential",
        minAge: c.params?.minAge,
        trustLevel: "presence-only-demo",
      };
    });
  }

  _door(rec) {
    if (!rec) return { ok: false, code: "not-found", trustLevel: "presence-only-demo" };
    if (rec.state === "verified") return { ok: true, mandateBundle: rec.bundle, authorization: rec.authorization, trustLevel: "presence-only-demo", total: rec.total };
    if (rec.state === "refused") return { ok: false, code: rec.code, credential: rec.credential, trustLevel: "presence-only-demo" };
    return { ok: false, pending: true, approveUrl: `${this.origin}/prove/${rec.id}`, trustLevel: "presence-only-demo" };
  }
}
