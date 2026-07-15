// #46 — the checkout stepper must reflect the order's ACTUAL gates, not a hardcoded
// Age · Membership · Pay. These fail if the rail goes back to promising steps the
// order doesn't have (the bug the visual review caught: a membership-less order
// showing a Membership step).
import { describe, it, expect } from "vitest";
import { checkoutRail } from "./theme.js";

// A rail step renders as <div class="rail-label">LABEL</div>.
const hasStep = (html: string, label: string): boolean => html.includes(`rail-label">${label}</div>`);

const ageOnly = { lines: [{ minimumAge: 21 }], discount: 0, total: 15 }; // ORD-DEMO shape

describe("checkoutRail reflects the order's actual gates (#46)", () => {
  it("an age-restricted, membership-less order shows Age + Pay — NOT Membership", () => {
    const html = checkoutRail(ageOnly, "age");
    expect(hasStep(html, "Age")).toBe(true);
    expect(hasStep(html, "Pay")).toBe(true);
    expect(hasStep(html, "Membership")).toBe(false); // no phantom step
  });

  it("on the payment page, Age is done and Pay is current (still no Membership)", () => {
    const html = checkoutRail(ageOnly, "pay");
    expect(hasStep(html, "Age")).toBe(true);
    expect(hasStep(html, "Membership")).toBe(false);
    expect(html).toContain("✓"); // the upstream Age step shows done
    expect(html).toContain('class="rail-step current"'); // Pay highlighted
  });

  it("includes Membership only when a discount is actually applied", () => {
    const withDiscount = { lines: [{ minimumAge: 21 }], discount: 2, total: 13 };
    expect(hasStep(checkoutRail(withDiscount, "pay"), "Membership")).toBe(true);
  });

  it("a non-age-restricted order shows no Age step", () => {
    const noAge = { lines: [{}], discount: 0, total: 15 };
    const html = checkoutRail(noAge, "pay");
    expect(hasStep(html, "Age")).toBe(false);
    expect(hasStep(html, "Pay")).toBe(true);
  });

  it("always includes the current gate, even if its applies-check is false", () => {
    // landing on the membership page for an order with no discount yet
    const html = checkoutRail(ageOnly, "membership");
    expect(hasStep(html, "Membership")).toBe(true);
  });
});
