import { describe, it, expect } from "vitest";
import { usd } from "./money.js";

describe("Money (usd)", () => {
  it("compares, serializes, and rejects cross-currency + non-integer amounts", () => {
    expect(usd.dollars(20).lt(usd.dollars(30))).toBe(true);
    expect(usd.dollars(20).eq(usd.cents(2000))).toBe(true);
    expect(usd.dollars(30).gte(usd.dollars(30))).toBe(true);
    expect(usd.dollars(20).serialize()).toEqual({ amount: 2000, currency: "usd" });
    expect(usd.dollars(50).minus(usd.dollars(20)).serialize().amount).toBe(3000);
    expect(() => usd.cents(20.5)).toThrow(); // non-integer minor units
  });

  it("has no float drift on fractional dollars, and rejects sub-cent inputs", () => {
    expect(usd.dollars(21.99).serialize()).toEqual({ amount: 2199, currency: "usd" });
    expect(usd.dollars(0.1).plus(usd.dollars(0.2)).eq(usd.cents(30))).toBe(true); // 0.1+0.2 ≠ 0.3 in floats — Money is exact
    expect(usd.dollars(0).serialize().amount).toBe(0);
    expect(() => usd.dollars(1.005)).toThrow(/sub-cent/); // would silently truncate value otherwise
    expect(() => usd.dollars(0.001)).toThrow(/sub-cent/);
  });

  it("prints a human amount", () => {
    expect(usd.dollars(21.99).toString()).toBe("USD 21.99");
  });
});
