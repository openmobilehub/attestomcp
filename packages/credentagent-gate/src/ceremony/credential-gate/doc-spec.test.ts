// Item 6 (PR #42 review) — a multi-credential DCQL must map to ONE iOS org-iso-mdoc
// doc spec PER credential, not just the first. Before the fix mdocDocSpecFromDcql read
// dcql.credentials[0], so on iOS (which asks by DeviceRequest) every credential after the
// first was silently dropped — a request that works on Android (OpenID4VP forwards the whole
// dcql_query) was truncated to one credential on iOS.
import { describe, it, expect } from "vitest";
import { mdocDocSpecsFromDcql } from "./doc-spec.js";
import { dcql } from "../../credentials.js";
import type { DcqlQuery } from "../../types.js";

describe("mdocDocSpecsFromDcql — every credential in a DCQL becomes an iOS doc spec (item 6)", () => {
  it("returns one spec per credential option, in order (not just the first)", () => {
    const q: DcqlQuery = {
      credentials: [
        dcql({ docType: "org.example.license.1", claims: ["license_active"] }).credentials[0],
        dcql({ docType: "org.example.residency.1", claims: ["resident_eu", "resident_country"] }).credentials[0],
      ],
    };
    const specs = mdocDocSpecsFromDcql(q);
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.docType)).toEqual(["org.example.license.1", "org.example.residency.1"]);
    expect(specs[1].elements).toEqual(["resident_eu", "resident_country"]);
  });

  it("a single-credential DCQL still yields exactly one spec (unchanged)", () => {
    const specs = mdocDocSpecsFromDcql(dcql({ docType: "org.hl7.prescription.1", claims: ["rx_valid"] }));
    expect(specs).toEqual([{ docType: "org.hl7.prescription.1", namespace: "org.hl7.prescription.1", elements: ["rx_valid"] }]);
  });
});
