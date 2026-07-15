// A DEFINED custom gate whose ceremony isn't mounted must render an HONEST page — not the
// misleading "Unknown credential" (which is reserved for genuinely-unknown creds).
import { describe, it, expect } from "vitest";
import { renderPendingGatePage } from "./page.js";

describe("renderPendingGatePage — honest 'not presentable yet'", () => {
  it("names the gate, says it's roadmap, links back — and NEVER claims 'Unknown credential'", () => {
    const html = renderPendingGatePage("Liquor license", "Verify license", "/checkout?order=ORD-1");
    expect(html).toContain("Liquor license");
    expect(html).toContain("Not presentable yet");
    expect(html).toContain("roadmap");
    expect(html).toContain("/checkout?order=ORD-1");
    expect(html).not.toContain("Unknown credential");
  });
});
