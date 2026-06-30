// Extensibility contract (CT5): a custom credential defined with defineCredential
// drops into the same policy and is gated by its own `appliesTo` — proving the
// "gate ANY credential" promise (Principle V), not just the three built-ins.

import { describe, it, expect } from "vitest";
import { AttestoMcp } from "./client.js";
import { defineCredential, dcql, gate, required } from "./credentials.js";
import type { GateOrder } from "./types.js";

const attestomcp = new AttestoMcp({ walletOrigin: "https://shop.example" });

const prescription = defineCredential({
  id: "prescription",
  request: dcql({ docType: "org.hl7.prescription.1", claims: ["rx_valid"] }),
  verify: (c) => c.rx_valid === true,
  effect: gate(),
  appliesTo: (order) => order.lines.some((l) => l.requiresRx), // only for Rx items
  ui: { label: "Prescription", action: "Verify prescription" },
});

const rxOrder: GateOrder = {
  id: "ORD-RX",
  total: 4200,
  currency: "USD",
  lines: [{ id: "amoxicillin", quantity: 1, unitPrice: 4200, requiresRx: true }],
};
const otcOrder: GateOrder = {
  id: "ORD-OTC",
  total: 1200,
  currency: "USD",
  lines: [{ id: "bandages", quantity: 1, unitPrice: 1200 }],
};

describe("CT5 — custom credential via defineCredential (appliesTo)", () => {
  it("appears only for an Rx line", () => {
    const manifest = attestomcp.requirements(rxOrder, [required(prescription)]);
    const rx = manifest.find((e) => e.credential === "prescription");
    expect(rx).toBeTruthy();
    expect(rx!.effect).toBe("gate");
    expect(rx!.approveUrl).toContain("/credential-gate/prescription");
    expect(rx!.approveUrl).toContain("ORD-RX");
  });

  it("is absent for a non-Rx line", () => {
    const manifest = attestomcp.requirements(otcOrder, [required(prescription)]);
    expect(manifest.find((e) => e.credential === "prescription")).toBeUndefined();
  });

  it("dcql sugar expands to the full verifier shape", () => {
    const q = dcql({ docType: "org.hl7.prescription.1", claims: ["rx_valid"] });
    expect(q.credentials[0].meta.doctype_value).toBe("org.hl7.prescription.1");
    expect(q.credentials[0].format).toBe("mso_mdoc");
    expect(q.credentials[0].claims[0].path).toEqual(["org.hl7.prescription.1", "rx_valid"]);
    expect(q.credentials[0].claims[0].intent_to_retain).toBe(false);
  });
});
