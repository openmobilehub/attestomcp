// The CredentAgent client — construction guards (origin binding is security-relevant)
// and the mount() store seam (per-order, never process-global).

import { describe, it, expect, vi } from "vitest";
import { CredentAgent } from "./client.js";
import { age, required } from "./credentials.js";
import type { GateOrder } from "./types.js";

const order: GateOrder = {
  id: "ORD-9",
  total: 12400,
  currency: "USD",
  lines: [{ id: "oak-whiskey", quantity: 1, unitPrice: 12400, minimumAge: 21 }],
};

describe("CredentAgent constructor", () => {
  it("works with no config — defaults walletOrigin to localhost", () => {
    const a = new CredentAgent();
    expect(a.walletOrigin).toMatch(/^http:\/\/localhost:\d+$/);
    // empty string is treated as unset → same default
    expect(new CredentAgent({ walletOrigin: "" }).walletOrigin).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it("warns (does NOT throw) on a non-absolute walletOrigin and falls back to the default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = new CredentAgent({ walletOrigin: "shop.example" }); // missing scheme
    expect(warn).toHaveBeenCalled();
    expect(a.walletOrigin).toMatch(/^http:\/\/localhost:\d+$/);
    warn.mockRestore();
  });

  it("warns (does NOT throw) on a localhost origin in production, but still uses it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const a = new CredentAgent({ walletOrigin: "http://localhost:3001" });
      expect(a.walletOrigin).toBe("http://localhost:3001");
      expect(warn).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
      warn.mockRestore();
    }
  });

  it("accepts an absolute origin and trims a trailing slash", () => {
    const a = new CredentAgent({ walletOrigin: "https://shop.example/" });
    expect(a.walletOrigin).toBe("https://shop.example");
  });

  it("delegates requirements() to the resolver (bound to its walletOrigin)", () => {
    const a = new CredentAgent({ walletOrigin: "https://shop.example" });
    const m = a.requirements(order, [required(age.over(21).when((o) => o.lines.some((l) => l.minimumAge != null)))]);
    const ageEntry = m.find((e) => e.credential === "age");
    expect(ageEntry?.approveUrl).toContain("https://shop.example/credential-gate/age");
    expect(ageEntry?.approveUrl).toContain("ORD-9");
  });
});

describe("CredentAgent.mount", () => {
  it("exposes the per-order store on app.locals and is idempotent", () => {
    const a = new CredentAgent({ walletOrigin: "https://shop.example" });
    const app = { locals: {} as Record<string, unknown> };
    a.mount(app);
    a.mount(app); // idempotent — no throw, same store
    expect((app.locals.credentagent as { store?: unknown }).store).toBe(a.store);
  });

  it("two clients keep distinct stores (no cross-instance bleed)", () => {
    const a = new CredentAgent({ walletOrigin: "https://a.example" });
    const b = new CredentAgent({ walletOrigin: "https://b.example" });
    expect(a.store).not.toBe(b.store);
  });
});
