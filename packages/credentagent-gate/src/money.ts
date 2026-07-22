// Money — an opaque, currency-checked value. Amounts are integer minor units (cents),
// so no float drift; the raw scalar is not public, so a caller can't accidentally compare
// or add a bare number across currencies (spec 009 FR-005). Build with `usd.dollars(20)` /
// `usd.cents(2000)`; compare with `.lt/.gte/.eq`; combine with `.plus/.minus`; emit the wire
// shape with `.serialize()`.

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

/** US dollars. `usd.dollars(20)` → $20.00 (2000 cents); `usd.cents(2000)` → the same. */
export const usd = Object.assign((minorCents: number) => money(minorCents, "usd"), {
  dollars: (d: number) => money(Math.round(d * 100), "usd"),
  cents: (c: number) => money(c, "usd"),
});
