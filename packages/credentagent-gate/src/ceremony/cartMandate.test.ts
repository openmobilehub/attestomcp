// Cart Mandate (ap2.CartMandate) — the signed integrity envelope + its enforcement on the
// shared completion path. These are BYPASS tests: each pins a control that, removed, lets a
// tampered / replayed / expired cart through. The honesty line (presence-only-demo, server
// HMAC = "the server issued this cart", not "the user authorized it") is carried in the type.
import { describe, it, expect } from "vitest";
import {
  issueCartMandate,
  verifyCartMandate,
  type CartMandate,
} from "./cartMandate.js";
import { completeOrder, type CompletedRecord, type CompletionContext } from "./completion.js";
import { MemoryVerificationStore } from "../store.js";
import type { CeremonyCatalog, CompletionInput } from "./types.js";

const SECRET = "cart-mandate-test-secret";
const round2 = (n: number) => Math.round(n * 100) / 100;

const PRODUCTS: Record<string, { price: number; minimumAge?: number }> = {
  widget: { price: 10 },
  gizmo: { price: 25 },
};

const catalog: CeremonyCatalog = {
  createOrder(items, orderId, opts) {
    const lines = items.map((it) => {
      const p = PRODUCTS[it.productId] ?? { price: 0 };
      return {
        id: it.productId,
        name: it.productId,
        unitPrice: p.price,
        currency: "USD",
        quantity: it.quantity,
        lineTotal: p.price * it.quantity,
        ...(p.minimumAge ? { minimumAge: p.minimumAge } : {}),
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const discount = opts?.loyaltyApplied ? round2(subtotal * 0.1) : 0;
    const total = round2(subtotal - discount);
    return { id: orderId, lines, itemCount: lines.reduce((s, l) => s + l.quantity, 0), subtotal, discount, total, currency: "USD", createdAt: new Date().toISOString() };
  },
};

// A cart mandate over a freshly-priced order (the valid baseline the bypass tests mutate).
function mandateFor(orderId: string, items: { productId: string; quantity: number }[], opts: { total?: number; now?: number } = {}): CartMandate {
  const order = catalog.createOrder(items, orderId);
  return issueCartMandate(
    {
      orderId,
      lines: order.lines.map((l) => ({ id: l.id, quantity: l.quantity, unitPrice: l.unitPrice ?? 0, lineTotal: l.lineTotal, ...(l.minimumAge ? { minimumAge: l.minimumAge } : {}) })),
      currency: order.currency,
      total: opts.total ?? order.total,
      ...(opts.now != null ? { now: opts.now } : {}),
    },
    SECRET,
  );
}

describe("cartMandate — issue + verify (the primitive)", () => {
  it("round-trips: a freshly issued mandate verifies against its order", () => {
    const m = mandateFor("ORD-1", [{ productId: "widget", quantity: 2 }]);
    expect(m.type).toBe("ap2.CartMandate");
    expect(m.total).toBe(20);
    expect(m.trust_level).toBe("presence-only-demo");
    const v = verifyCartMandate(m, "ORD-1", SECRET);
    expect(v.ok).toBe(true);
  });

  it("REFUSES a tampered total (signature mismatch) — the seal is load-bearing", () => {
    const m = mandateFor("ORD-1", [{ productId: "widget", quantity: 2 }]);
    const tampered = { ...m, total: 1 }; // edit the sealed total, keep the old signature
    const v = verifyCartMandate(tampered, "ORD-1", SECRET);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe("signature");
  });

  it("REFUSES a tampered line (qty/price edit changes the canonical bytes)", () => {
    const m = mandateFor("ORD-1", [{ productId: "widget", quantity: 2 }]);
    const tampered = { ...m, lines: [{ ...m.lines[0], quantity: 99 }] };
    expect(verifyCartMandate(tampered, "ORD-1", SECRET)).toMatchObject({ ok: false, reason: "signature" });
  });

  it("REFUSES a mandate signed with a different key (forgery)", () => {
    const forged = mandateFor("ORD-1", [{ productId: "widget", quantity: 2 }]);
    expect(verifyCartMandate(forged, "ORD-1", "WRONG-SECRET")).toMatchObject({ ok: false, reason: "signature" });
  });

  it("REFUSES a valid mandate REPLAYED against a different order (order-id binding)", () => {
    const m = mandateFor("ORD-1", [{ productId: "widget", quantity: 2 }]);
    expect(verifyCartMandate(m, "ORD-OTHER", SECRET)).toMatchObject({ ok: false, reason: "order-id" });
  });

  it("REFUSES an expired mandate with a DISTINCT reason (not 'signature')", () => {
    const m = mandateFor("ORD-1", [{ productId: "widget", quantity: 2 }], { now: 1_000 }); // issued in the deep past
    const v = verifyCartMandate(m, "ORD-1", SECRET, m.expiresAt + 1); // now is past expiry
    expect(v).toMatchObject({ ok: false, reason: "expired" });
  });

  it("REFUSES a malformed / non-mandate object", () => {
    expect(verifyCartMandate(null, "ORD-1", SECRET)).toMatchObject({ ok: false, reason: "malformed" });
    expect(verifyCartMandate({ type: "nope" }, "ORD-1", SECRET)).toMatchObject({ ok: false, reason: "malformed" });
  });
});

// ── Enforcement on the shared completion path (additive, fail-closed) ────────────
type Harness = { ctx: CompletionContext; records: Map<string, CompletedRecord>; input: (over: Partial<CompletionInput>) => CompletionInput };

function harness(): Harness {
  const records = new Map<string, CompletedRecord>();
  const ctx: CompletionContext = {
    catalog,
    verificationStore: new MemoryVerificationStore(),
    records: { read: async (id) => records.get(id), write: async (rec) => void records.set(rec.orderId, rec) },
    signingKey: SECRET,
  };
  const base = (): CompletionInput => {
    const order = catalog.createOrder([{ productId: "widget", quantity: 2 }], "ORD-C");
    return { order, mandateId: "m1", amount: order.total, currency: "USD", method: "test", gates: [{ gate: "g", pass: true, detail: "" }] };
  };
  return { ctx, records, input: (over) => ({ ...base(), ...over }) };
}

describe("cartMandate — enforced on completeOrder before re-pricing", () => {
  it("a VALID cart mandate completes (and a missing one is additive — also completes)", async () => {
    const h = harness();
    const withMandate = await completeOrder(h.input({ cartMandate: mandateFor("ORD-C", [{ productId: "widget", quantity: 2 }]) }), h.ctx);
    expect(withMandate.completed).toBe(true);
    // Additive: no cartMandate ⇒ the check is skipped, completion behaves as before.
    const h2 = harness();
    expect((await completeOrder(h2.input({}), h2.ctx)).completed).toBe(true);
  });

  it("BYPASS: a TAMPERED cart mandate is refused on the completion path (reason 'cart-mandate'), records nothing", async () => {
    const h = harness();
    const valid = mandateFor("ORD-C", [{ productId: "widget", quantity: 2 }]);
    const tampered = { ...valid, total: 1 }; // order.total stays correct (20) so re-price alone would NOT catch this
    const res = await completeOrder(h.input({ cartMandate: tampered }), h.ctx);
    expect(res.completed).toBe(false);
    expect(res.reason).toBe("cart-mandate");
    expect(h.records.size).toBe(0);
  });

  it("INVARIANT 2 holds independently: a VALID-signature mandate over a wrong (low) total is still refused by re-pricing", async () => {
    const h = harness();
    // Mandate validly signed over total 5, and the order claims total 5 — the cart-mandate
    // check PASSES (it's internally consistent + signed), but the catalog reprices to 20, so
    // re-pricing refuses. The signature proves issuance, never the price.
    const order = catalog.createOrder([{ productId: "widget", quantity: 2 }], "ORD-C");
    const lowMandate = mandateFor("ORD-C", [{ productId: "widget", quantity: 2 }], { total: 5 });
    const res = await completeOrder({ order: { ...order, total: 5 }, mandateId: "m", amount: 5, currency: "USD", method: "test", gates: [{ gate: "g", pass: true, detail: "" }], cartMandate: lowMandate }, h.ctx);
    expect(res.completed).toBe(false);
    expect(res.reason).toBe("reprice");
  });
});
