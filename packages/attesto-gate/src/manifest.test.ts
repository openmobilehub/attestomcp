// Contract tests for the code→data boundary, `requirements()` (Principle VI).
// These exercise the load-bearing properties: nothing-but-data on the wire,
// conditional drop, payment-last, required/optional, and the honesty axes.

import { describe, it, expect } from "vitest";
import { Attesto } from "./client.js";
import { age, membership, payment, required, optional } from "./credentials.js";
import type { GateOrder } from "./types.js";

const attesto = new Attesto({ walletOrigin: "https://shop.example" });

const alcoholOrder: GateOrder = {
  id: "ORD-1",
  total: 12400,
  currency: "USD",
  lines: [{ id: "oak-whiskey", quantity: 1, unitPrice: 12400, minimumAge: 21, category: "Beverages" }],
};
const plainOrder: GateOrder = {
  id: "ORD-2",
  total: 6900,
  currency: "USD",
  lines: [{ id: "drift-mouse", quantity: 1, unitPrice: 6900, category: "Electronics" }],
};

// Grounded in the real catalog: alcohol items carry `minimumAge`, there is no
// "alcohol" category (see catalog.ts).
const hasAlcohol = (o: GateOrder) => o.lines.some((l) => l.minimumAge != null);

const fullPolicy = [
  required(age.over(21).when(hasAlcohol)),
  optional(membership.discount(10)),
  required(payment.in("usd")),
];

describe("CT1 — serialization (no functions on the wire)", () => {
  it("JSON.stringify round-trips deeply equal; no function-valued fields", () => {
    const manifest = attesto.requirements(alcoholOrder, fullPolicy);
    const round = JSON.parse(JSON.stringify(manifest));
    expect(round).toEqual(manifest);
    for (const entry of manifest) {
      for (const value of Object.values(entry)) {
        expect(typeof value).not.toBe("function");
      }
    }
  });
});

describe("CT8 — honesty axes (Principle VII)", () => {
  it("every entry carries enforcedAt + trust_level", () => {
    const manifest = attesto.requirements(alcoholOrder, fullPolicy);
    expect(manifest.length).toBeGreaterThan(0);
    for (const entry of manifest) {
      expect(entry.enforcedAt).toBe("checkout"); // consolidated Mode A
      expect(entry.trust_level).toBe("presence-only-demo"); // v0.1 — not a real safety control
    }
  });
});

describe("CT2 — conditional drop (.when)", () => {
  it("non-alcohol cart ⇒ no age entry", () => {
    const manifest = attesto.requirements(plainOrder, fullPolicy);
    expect(manifest.find((e) => e.credential === "age")).toBeUndefined();
  });

  it("alcohol cart ⇒ age at minAge:21 with an approveUrl bound to THIS order id", () => {
    const manifest = attesto.requirements(alcoholOrder, fullPolicy);
    const ageEntry = manifest.find((e) => e.credential === "age");
    expect(ageEntry).toBeTruthy();
    expect(ageEntry!.effect).toBe("gate");
    expect(ageEntry!.minAge).toBe(21);
    expect(ageEntry!.approveUrl).toContain("ORD-1");
    expect(ageEntry!.approveUrl).toContain("/credential-gate/age");
  });
});

describe("CT3 — payment settles last", () => {
  it("payment resolves last even when declared first", () => {
    const policy = [
      required(payment.in("usd")), // declared FIRST
      required(age.over(21).when(hasAlcohol)),
      optional(membership.discount(10)),
    ];
    const manifest = attesto.requirements(alcoholOrder, policy);
    expect(manifest[manifest.length - 1].credential).toBe("payment");
    expect(manifest[manifest.length - 1].effect).toBe("authorize");
  });
});

describe("CT4 — required vs optional", () => {
  it("optional(membership) is present but never required; required(age) is required", () => {
    const manifest = attesto.requirements(alcoholOrder, fullPolicy);
    const member = manifest.find((e) => e.credential === "membership");
    const ageEntry = manifest.find((e) => e.credential === "age");
    expect(member!.required).toBe(false);
    expect(member!.effect).toBe("discount");
    expect(member!.discountPct).toBe(10);
    expect(ageEntry!.required).toBe(true);
  });
});
