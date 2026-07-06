// Tests for firestoreCatalog() — the first-class DYNAMIC catalog source (spec 006).
// Everything runs against an injected fake Firestore, so there is no live Firebase and
// `firebase-admin` is never loaded. Each security control (fail-closed cold load, doc
// validation, last-known-good) has a test that FAILS if the control is removed.

import { describe, it, expect, vi, afterEach } from "vitest";
import { firestoreCatalog, type FirestoreLike } from "./firestore.js";

// A fake Firestore standing in for one collection. `fail(true)` makes the next `.get()`
// throw (an unreachable backend); `getCalls()` proves the TTL cache skips re-fetches.
function fakeFirestore(
  docs: Array<{ id: string; data: Record<string, unknown> }>,
): FirestoreLike & { fail: (v: boolean) => void; getCalls: () => number } {
  let getCalls = 0;
  let failing = false;
  return {
    fail: (v: boolean) => { failing = v; },
    getCalls: () => getCalls,
    collection() {
      return {
        async get() {
          getCalls += 1;
          if (failing) throw new Error("firestore unreachable");
          return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
        },
      };
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("firestoreCatalog — load + map (US1)", () => {
  it("loads products from the collection and maps docs to Product (currency defaults to USD)", async () => {
    const src = firestoreCatalog({
      client: fakeFirestore([
        { id: "drift-mouse", data: { name: "Drift Mouse", price: 49 } },
        { id: "oak-whiskey", data: { name: "Oak", price: 124, currency: "USD", category: "Beverages", minimumAge: 21 } },
      ]),
    });
    const loaded = await src.load();
    expect(loaded).toEqual([
      { id: "drift-mouse", name: "Drift Mouse", price: 49, currency: "USD", image: "", category: "", description: "" },
      { id: "oak-whiskey", name: "Oak", price: 124, currency: "USD", image: "", category: "Beverages", description: "", minimumAge: 21 },
    ]);
    expect(src.current()).toEqual(loaded);
  });

  it("current() throws before the first successful load (fail-closed backstop)", () => {
    const src = firestoreCatalog({ client: fakeFirestore([{ id: "a", data: { name: "A", price: 1 } }]) });
    expect(() => src.current()).toThrow(/not loaded/i);
  });
});

describe("firestoreCatalog — TTL cache (US1 / FR TTL)", () => {
  it("serves the cache within ttlMs, re-fetches after it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const fs = fakeFirestore([{ id: "a", data: { name: "A", price: 1 } }]);
    const src = firestoreCatalog({ client: fs, ttlMs: 1000 });

    await src.load();
    await src.load(); // still fresh → no second fetch
    expect(fs.getCalls()).toBe(1);

    vi.setSystemTime(1_001_500); // past the TTL
    await src.load();
    expect(fs.getCalls()).toBe(2);
  });
});

describe("firestoreCatalog — fail-closed (Security invariant 2)", () => {
  it("refuses an EMPTY cold load instead of serving an empty catalog", async () => {
    const src = firestoreCatalog({ client: fakeFirestore([]) });
    await expect(src.load()).rejects.toThrow(/empty/i);
    expect(() => src.current()).toThrow(/not loaded/i); // nothing cached
  });

  it("propagates an UNREACHABLE cold load (no last-known-good to fall back to)", async () => {
    const fs = fakeFirestore([{ id: "a", data: { name: "A", price: 1 } }]);
    fs.fail(true); // down on the very first load
    const src = firestoreCatalog({ client: fs });
    await expect(src.load()).rejects.toThrow(/unreachable/);
  });

  // Control (load-bearing): a malformed / negative-price doc FAILS the load. If the
  // validation were dropped (return the raw doc), these would resolve — the tests fail.
  it("rejects a doc missing a name", async () => {
    const src = firestoreCatalog({ client: fakeFirestore([{ id: "bad", data: { price: 10 } }]) });
    await expect(src.load()).rejects.toThrow(/name/i);
  });

  it("rejects a negative price", async () => {
    const src = firestoreCatalog({ client: fakeFirestore([{ id: "neg", data: { name: "N", price: -5 } }]) });
    await expect(src.load()).rejects.toThrow(/price/i);
  });

  it("rejects a non-finite price", async () => {
    const src = firestoreCatalog({ client: fakeFirestore([{ id: "nan", data: { name: "N", price: Number.POSITIVE_INFINITY } }]) });
    await expect(src.load()).rejects.toThrow(/price/i);
  });
});

describe("firestoreCatalog — last-known-good on a refresh blip (FR resilience)", () => {
  it("serves the previous catalog when a REFRESH (not the cold load) fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const fs = fakeFirestore([{ id: "a", data: { name: "A", price: 1 } }]);
    const src = firestoreCatalog({ client: fs, ttlMs: 1000 });

    const first = await src.load(); // good cold load
    fs.fail(true); // backend goes down
    vi.setSystemTime(1_001_500); // past TTL → triggers a refresh, which fails

    const second = await src.load();
    expect(second).toEqual(first); // last-known-good served, NOT a throw
    expect(src.current()).toEqual(first);
  });
});

describe("firestoreCatalog — missing peer dependency (US2)", () => {
  it("is lazy (no throw at construction) and surfaces an actionable firebase-admin error on load", async () => {
    const src = firestoreCatalog({
      // Simulate `firebase-admin` being absent (testable while it is NOT installed here).
      _load: async () => { throw new Error("Cannot find module 'firebase-admin/app'"); },
    });
    await expect(src.load()).rejects.toThrow(/firebase-admin/);
  });
});
