import { describe, it, expect } from "vitest";
import { CredentAgent } from "./client.js";
import { usd } from "./money.js";
import { age, payment, required } from "./credentials.js";

const anOrder = () => ({
  id: "",
  total: 2100,
  currency: "USD",
  lines: [{ id: "wine", quantity: 1, unitPrice: 2100, minimumAge: 21 }],
});
const aPolicy = () => [required(age.over(21)), required(payment.in("usd"))];

describe("credentagent.orders", () => {
  it("create() returns an id, an approveUrl on this origin, and the resolved manifest", () => {
    const ca = new CredentAgent({ walletOrigin: "https://shop.example" });
    const { id, approveUrl, manifest } = ca.orders.create({ order: anOrder(), policy: aPolicy() });
    expect(id).toMatch(/^ord_/);
    expect(approveUrl).toBe(`https://shop.example/credentagent/orders/${id}`);
    const creds = manifest.map((m) => m.credential);
    expect(creds).toContain("age");
    expect(creds).toContain("payment");
  });

  // The load-bearing control: an order is `ok` ONLY once it has actually completed (the
  // completed-order store holds it). Delete that gate — make retrieve() return ok for a merely
  // *created* order — and this test goes red: an unproven order would read as done.
  it("BYPASS: an order retrieves as PENDING until it completes — never ok before", async () => {
    const ca = new CredentAgent({ walletOrigin: "https://shop.example" });
    const { id } = ca.orders.create({ order: anOrder(), policy: aPolicy() });

    const before = await ca.orders.retrieve(id);
    expect(before.ok).toBe(false);
    expect(before).toMatchObject({ pending: true, approveUrl: expect.stringContaining(id) });

    // what the ceremony's completeOrder path does when the human finishes:
    await ca.orders._complete({ orderId: id, amount: 2100, currency: "USD", method: "passkey", completedAt: "t" });

    const after = await ca.orders.retrieve(id);
    expect(after.ok).toBe(true);
  });

  // Invariant 4 — state is keyed per order; one order's completion never unlocks another.
  it("scopes per order: completing A does not make B ok", async () => {
    const ca = new CredentAgent({ walletOrigin: "https://shop.example" });
    const a = ca.orders.create({ order: anOrder(), policy: aPolicy() });
    const b = ca.orders.create({ order: anOrder(), policy: aPolicy() });
    await ca.orders._complete({ orderId: a.id });
    expect((await ca.orders.retrieve(a.id)).ok).toBe(true);
    expect((await ca.orders.retrieve(b.id)).ok).toBe(false); // B untouched
  });

  it("fires order.settled once on completion (in-process event, not a poll loop)", async () => {
    const ca = new CredentAgent({ walletOrigin: "https://shop.example" });
    const seen: string[] = [];
    ca.on("order.settled", ({ id }) => seen.push(id));
    const { id } = ca.orders.create({ order: anOrder(), policy: aPolicy() });
    await ca.orders._complete({ orderId: id });
    expect(seen).toEqual([id]);
  });

  it("retrieve of an unknown id is a typed refusal, not a throw", async () => {
    const ca = new CredentAgent({ walletOrigin: "https://shop.example" });
    expect(await ca.orders.retrieve("ord_nope")).toMatchObject({ ok: false, code: "not-found" });
  });
});

describe("Money (usd)", () => {
  it("compares, serializes, and rejects cross-currency + non-integer amounts", () => {
    expect(usd.dollars(20).lt(usd.dollars(30))).toBe(true);
    expect(usd.dollars(20).eq(usd.cents(2000))).toBe(true);
    expect(usd.dollars(30).gte(usd.dollars(30))).toBe(true);
    expect(usd.dollars(20).serialize()).toEqual({ amount: 2000, currency: "usd" });
    expect(usd.dollars(50).minus(usd.dollars(20)).serialize().amount).toBe(3000);
    expect(() => usd(20.5)).toThrow();
  });
});
