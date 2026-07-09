// Direct unit tests of the shared completeOrder seam. Until now its controls — every
// deterministic gate must pass, the catalog re-prices (never the token), an age-restricted
// order needs a proven per-order age claim, idempotency, and fail-closed settlement — were
// covered only TRANSITIVELY through the rail suites. These pin them at the seam, each as a
// BYPASS test that fails if its control is removed (Security invariants 1-3 + FR-013).
import { describe, it, expect, vi } from "vitest";
import { completeOrder, type CompletedRecord, type CompletionContext, type SettlementRecordLike } from "./completion.js";
import { MemoryVerificationStore } from "../store.js";
import type { Credential } from "../types.js";
import { professionalLicense, prescription } from "./credential-gate/__fixtures__/customCredential.js";
import type { CeremonyCatalog, CompletionInput } from "./types.js";

const round2 = (n: number) => Math.round(n * 100) / 100;
const PRODUCTS: Record<string, { price: number; minimumAge?: number; category?: string; requiresRx?: boolean }> = {
  widget: { price: 10 },
  wine: { price: 20, minimumAge: 21 },
  drill: { price: 50, category: "Licensed" }, // 007: the custom gate's applicable line
  amoxicillin: { price: 30, requiresRx: true }, // 007: keyed on a NON-category field (fail-open repro)
};

const catalog: CeremonyCatalog = {
  createOrder(items, orderId, opts) {
    const lines = items.map((it) => {
      const p = PRODUCTS[it.productId] ?? { price: 0 };
      return { id: it.productId, name: it.productId, unitPrice: p.price, currency: "USD", quantity: it.quantity, lineTotal: p.price * it.quantity, ...(p.minimumAge ? { minimumAge: p.minimumAge } : {}), ...(p.category ? { category: p.category } : {}), ...(p.requiresRx ? { requiresRx: true } : {}) };
    });
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    const discount = opts?.loyaltyApplied ? round2(subtotal * 0.1) : 0;
    return { id: orderId, lines, itemCount: lines.reduce((s, l) => s + l.quantity, 0), subtotal, discount, total: round2(subtotal - discount), currency: "USD", createdAt: new Date().toISOString() };
  },
};

// The worked pack + the requiresRx prescription gate come from the shared fixture (T002).
const licenseRegistry = new Map<string, Credential>([[professionalLicense.id, professionalLicense]]);
const rxRegistry = new Map<string, Credential>([[prescription.id, prescription]]);

interface Harness {
  ctx: CompletionContext;
  records: Map<string, CompletedRecord>;
  store: MemoryVerificationStore;
  cleared: { count: number };
  input: (items: { productId: string; quantity: number }[], over?: Partial<CompletionInput>) => CompletionInput;
}

function harness(opts: { settle?: CompletionContext["settle"]; registry?: ReadonlyMap<string, Credential> } = {}): Harness {
  const records = new Map<string, CompletedRecord>();
  const store = new MemoryVerificationStore();
  const cleared = { count: 0 };
  const ctx: CompletionContext = {
    catalog,
    verificationStore: store,
    records: { read: async (id) => records.get(id), write: async (rec) => void records.set(rec.orderId, rec) },
    cart: { clear: async () => void cleared.count++ },
    ...(opts.settle ? { settle: opts.settle } : {}),
    ...(opts.registry ? { credentialRegistry: opts.registry } : {}),
  };
  const input: Harness["input"] = (items, over = {}) => {
    const order = catalog.createOrder(items, over.order?.id ?? "ORD-1", {});
    return { order, mandateId: "m", amount: order.total, currency: "USD", method: "test", gates: [{ gate: "g", pass: true, detail: "" }], ...over };
  };
  return { ctx, records, store, cleared, input };
}

describe("completeOrder — core controls (direct seam tests)", () => {
  it("happy path: gates pass + price matches ⇒ completes, records, clears the cart", async () => {
    const h = harness();
    const res = await completeOrder(h.input([{ productId: "widget", quantity: 2 }]), h.ctx);
    expect(res.completed).toBe(true);
    expect(h.records.get("ORD-1")?.amount).toBe(20);
    expect(h.cleared.count).toBe(1);
  });

  it("BYPASS: a failed gate refuses (reason 'gates'), records nothing, clears nothing", async () => {
    const h = harness();
    const res = await completeOrder(h.input([{ productId: "widget", quantity: 2 }], { gates: [{ gate: "g", pass: false, detail: "x" }] }), h.ctx);
    expect(res).toMatchObject({ completed: false, reason: "gates" });
    expect(h.records.size).toBe(0);
    expect(h.cleared.count).toBe(0);
  });

  it("BYPASS (invariant 2): a token total that disagrees with the catalog is refused (reason 'reprice')", async () => {
    const h = harness();
    const i = h.input([{ productId: "widget", quantity: 2 }]); // catalog = 20
    const tampered = { ...i, order: { ...i.order, total: 1 } }; // claim 1
    const res = await completeOrder(tampered, h.ctx);
    expect(res).toMatchObject({ completed: false, reason: "reprice" });
    expect(h.records.size).toBe(0);
  });

  it("BYPASS (invariant 1+5): an age-restricted order with NO proven age is refused (reason 'age')", async () => {
    const h = harness();
    const res = await completeOrder(h.input([{ productId: "wine", quantity: 1 }]), h.ctx); // minimumAge 21, store unset
    expect(res).toMatchObject({ completed: false, reason: "age" });
    expect(h.records.size).toBe(0);
  });

  it("the SAME age-restricted order completes once age is proven (so the refusal was the age control)", async () => {
    const h = harness();
    await h.store.write("ORD-1", { ageVerified: true });
    const res = await completeOrder(h.input([{ productId: "wine", quantity: 1 }]), h.ctx);
    expect(res.completed).toBe(true);
    expect(h.records.get("ORD-1")?.amount).toBe(20);
  });

  it("idempotent: a replayed completion echoes the record and settles/records nothing twice", async () => {
    const settle = vi.fn(async () => ({ network: "x", txId: "t1", status: "settled" }) as SettlementRecordLike);
    const h = harness({ settle });
    const first = await completeOrder(h.input([{ productId: "widget", quantity: 2 }]), h.ctx);
    const second = await completeOrder(h.input([{ productId: "widget", quantity: 2 }]), h.ctx);
    expect(first.completed && second.completed).toBe(true);
    expect(settle).toHaveBeenCalledTimes(1); // not re-settled on replay
    expect(h.cleared.count).toBe(1);
  });

  it("FR-013 fail-closed: a thrown settle records NOTHING and leaves the cart intact (authorized-not-settled)", async () => {
    const settle = vi.fn(async () => { throw new Error("chain down"); });
    const h = harness({ settle });
    const res = await completeOrder(h.input([{ productId: "widget", quantity: 2 }]), h.ctx);
    expect(res.completed).toBe(false);
    expect(res.settlementError).toContain("chain down");
    expect(h.records.size).toBe(0);
    expect(h.cleared.count).toBe(0); // cart NOT emptied — the buyer can retry
  });

  it("a successful settle attaches the record, writes completion, and clears the cart", async () => {
    const settle = vi.fn(async () => ({ network: "hedera-testnet", txId: "0.0.1@1", status: "settled" }) as SettlementRecordLike);
    const h = harness({ settle });
    const res = await completeOrder(h.input([{ productId: "widget", quantity: 2 }]), h.ctx);
    expect(res.completed).toBe(true);
    expect(res.settlement?.txId).toBe("0.0.1@1");
    expect(h.records.get("ORD-1")?.settlement?.txId).toBe("0.0.1@1");
    expect(h.cleared.count).toBe(1);
  });
});

// ── US2 (007): completeOrder enforces every applicable custom gate() credential ──
// Each is a BYPASS test: it FAILS if the registry sweep is removed from completeOrder.
describe("completeOrder — custom gate() enforcement (007, US2 / invariant 1)", () => {
  it("BYPASS: an applicable custom gate() with no proven verification is refused (reason 'gate'), records nothing", async () => {
    const h = harness({ registry: licenseRegistry });
    const res = await completeOrder(h.input([{ productId: "drill", quantity: 1 }]), h.ctx); // Licensed line, verifiedGates unset
    expect(res).toMatchObject({ completed: false, reason: "gate" }); // FAILS if the sweep is removed → wrongly completes
    expect(h.records.size).toBe(0);
    expect(h.cleared.count).toBe(0);
  });

  it("the SAME order completes once the custom gate is verified (so the refusal was the gate control)", async () => {
    const h = harness({ registry: licenseRegistry });
    await h.store.write("ORD-1", { verifiedGates: { professional_license: true } });
    const res = await completeOrder(h.input([{ productId: "drill", quantity: 1 }]), h.ctx);
    expect(res.completed).toBe(true);
    expect(h.records.get("ORD-1")?.amount).toBe(50);
  });

  it("per-order scoping (invariant 4): a gate verified for ORD-A does NOT complete ORD-B (same credential)", async () => {
    const h = harness({ registry: licenseRegistry });
    await h.store.write("ORD-A", { verifiedGates: { professional_license: true } });
    const orderB = catalog.createOrder([{ productId: "drill", quantity: 1 }], "ORD-B");
    const res = await completeOrder({ order: orderB, mandateId: "m", amount: orderB.total, currency: "USD", method: "test", gates: [{ gate: "g", pass: true, detail: "" }] }, h.ctx);
    expect(res).toMatchObject({ completed: false, reason: "gate" }); // B never unlocked by A
  });

  it("a NON-applicable custom gate does not block (appliesTo false on the re-priced order)", async () => {
    const h = harness({ registry: licenseRegistry });
    const res = await completeOrder(h.input([{ productId: "widget", quantity: 1 }]), h.ctx); // no Licensed line
    expect(res.completed).toBe(true);
  });

  it("F3/FR-009: a custom gate() composed with a loyalty discount does not disturb amount binding", async () => {
    const h = harness({ registry: licenseRegistry });
    // Licensed drill (50) + loyalty applied ⇒ discount 5 ⇒ total 45; custom gate proven.
    await h.store.write("ORD-1", { verifiedGates: { professional_license: true }, loyalty: { applied: true, membershipNumber: "M-1" } });
    const order = catalog.createOrder([{ productId: "drill", quantity: 1 }], "ORD-1", { loyaltyApplied: true });
    const lineSum = round2(order.lines.reduce((s, l) => s + l.lineTotal, 0));
    expect(order.subtotal).toBe(lineSum);
    expect(order.total).toBe(round2(lineSum - order.discount)); // 45
    const res = await completeOrder({ order, mandateId: "m", amount: order.total, currency: "USD", method: "test", gates: [{ gate: "g", pass: true, detail: "" }] }, h.ctx);
    expect(res.completed).toBe(true);
    expect(h.records.get("ORD-1")?.amount).toBe(45); // custom gate coexists with the discount, amount reconciles
  });

  it("no registry ⇒ the custom sweep no-ops (additive): an applicable-gate order still completes", async () => {
    const h = harness(); // no registry wired
    const res = await completeOrder(h.input([{ productId: "drill", quantity: 1 }]), h.ctx);
    expect(res.completed).toBe(true); // the sweep only runs when a registry is injected
  });

  it("BYPASS (fail-open): a gate keyed on a NON-category field (requiresRx) is enforced, not skipped", async () => {
    const h = harness({ registry: rxRegistry });
    // amoxicillin's re-priced line carries requiresRx; the prescription gate applies but is
    // unproven. This FAILS (order wrongly completes) if the sweep evaluates appliesTo against
    // a lossy projection that drops requiresRx — the fail-open Diego reported.
    const res = await completeOrder(h.input([{ productId: "amoxicillin", quantity: 1 }]), h.ctx);
    expect(res).toMatchObject({ completed: false, reason: "gate" });
    expect(h.records.size).toBe(0);
  });

  it("the SAME requiresRx order completes once the prescription is proven for it", async () => {
    const h = harness({ registry: rxRegistry });
    await h.store.write("ORD-1", { verifiedGates: { prescription: true } });
    const res = await completeOrder(h.input([{ productId: "amoxicillin", quantity: 1 }]), h.ctx);
    expect(res.completed).toBe(true);
  });
});
