// Money — an opaque, currency-checked value. Amounts are integer minor units (cents),
// so no float drift; the raw scalar is not public, so a caller can't accidentally compare
// or add a bare number across currencies (spec 009 FR-005). Build with `usd.dollars(20)` /
// `usd.cents(2000)` — the unit is ALWAYS explicit (there is no bare `usd(n)`, which would be
// ambiguous between dollars and cents); compare with `.lt/.gte/.eq`; combine with
// `.plus/.minus`; emit the wire shape with `.serialize()`.

export interface Money {
  readonly currency: string;
  lt(other: Money): boolean;
  gte(other: Money): boolean;
  eq(other: Money): boolean;
  plus(other: Money): Money;
  minus(other: Money): Money;
  /** The wire form: `{ amount: <integer minor units>, currency }`. */
  serialize(): { amount: number; currency: string };
  toString(): string;
}

function money(minor: number, currency: string): Money {
  if (!Number.isInteger(minor)) throw new Error(`Money must be an integer minor-unit amount, got ${minor}`);
  const same = (o: Money) => {
    if (o.currency !== currency) throw new Error(`currency mismatch: ${currency} vs ${o.currency}`);
    return o.serialize().amount;
  };
  return Object.freeze<Money>({
    currency,
    lt: (o: Money) => minor < same(o),
    gte: (o: Money) => minor >= same(o),
    eq: (o: Money) => minor === same(o),
    plus: (o: Money) => money(minor + same(o), currency),
    minus: (o: Money) => money(minor - same(o), currency),
    serialize: () => ({ amount: minor, currency }),
    toString: () => `${currency.toUpperCase()} ${(minor / 100).toFixed(2)}`,
  });
}

/** Build US-dollar Money. The unit is always explicit: `usd.dollars(20)` → $20.00 (2000
 *  cents), `usd.cents(2000)` → the same. `.dollars` rounds a representable fractional dollar
 *  (19.99 → 1999) but REJECTS a genuine sub-cent input (1.005, 0.001) rather than silently
 *  truncating value — a sibling of `.cents`'s integer check. */
export const usd = {
  dollars: (d: number): Money => {
    const cents = d * 100;
    if (Math.abs(cents - Math.round(cents)) > 1e-6) {
      throw new Error(`usd.dollars(${d}) is a sub-cent amount; the smallest unit is one cent (use usd.cents for exact minor units)`);
    }
    return money(Math.round(cents), "usd");
  },
  cents: (c: number): Money => money(c, "usd"),
};
