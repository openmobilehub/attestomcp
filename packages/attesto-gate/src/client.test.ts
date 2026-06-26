// The Attesto client — construction guards (origin binding is security-relevant)
// and the mount() store seam (per-order, never process-global).

import { describe, it, expect } from "vitest";
import { Attesto } from "./client.js";
import { age, required } from "./credentials.js";
import type { GateOrder } from "./types.js";

const order: GateOrder = {
  id: "ORD-9",
  total: 12400,
  currency: "USD",
  lines: [{ id: "oak-whiskey", quantity: 1, unitPrice: 12400, minimumAge: 21 }],
};

describe("Attesto constructor", () => {
  it("refuses a non-absolute walletOrigin (origin binding is load-bearing)", () => {
    expect(() => new Attesto({ walletOrigin: "shop.example" })).toThrow();
    expect(() => new Attesto({ walletOrigin: "" })).toThrow();
  });

  it("accepts an absolute origin and trims a trailing slash", () => {
    const a = new Attesto({ walletOrigin: "https://shop.example/" });
    expect(a.walletOrigin).toBe("https://shop.example");
  });

  it("delegates requirements() to the resolver (bound to its walletOrigin)", () => {
    const a = new Attesto({ walletOrigin: "https://shop.example" });
    const m = a.requirements(order, [required(age.over(21).when((o) => o.lines.some((l) => l.minimumAge != null)))]);
    const ageEntry = m.find((e) => e.credential === "age");
    expect(ageEntry?.approveUrl).toContain("https://shop.example/credential-gate/age");
    expect(ageEntry?.approveUrl).toContain("ORD-9");
  });
});

describe("Attesto.mount", () => {
  it("exposes the per-order store on app.locals and is idempotent", () => {
    const a = new Attesto({ walletOrigin: "https://shop.example" });
    const app = { locals: {} as Record<string, unknown> };
    a.mount(app);
    a.mount(app); // idempotent — no throw, same store
    expect((app.locals.attesto as { store?: unknown }).store).toBe(a.store);
  });

  it("two clients keep distinct stores (no cross-instance bleed)", () => {
    const a = new Attesto({ walletOrigin: "https://a.example" });
    const b = new Attesto({ walletOrigin: "https://b.example" });
    expect(a.store).not.toBe(b.store);
  });
});
