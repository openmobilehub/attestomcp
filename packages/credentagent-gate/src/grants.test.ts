import { describe, it, expect } from "vitest";
import { CredentAgent } from "./client.js";
import { usd } from "./money.js";
import type { GrantRecord } from "./grants.js";
import type { OrderStore } from "./orders.js";

const terms = () => ({ merchant: "utopia", budget: usd.dollars(100), perSpend: usd.dollars(30) });

describe("credentagent.grants — create / retrieve (the pending lifecycle)", () => {
  it("create() returns a pending grant with an approveUrl on this origin, terms echoed as Money", async () => {
    const ca = new CredentAgent({ walletOrigin: "https://shop.example" });
    const g = await ca.grants.create({ ...terms(), policy: [] });
    expect(g.id).toMatch(/^gr_/);
    expect(g.status).toBe("pending");
    expect(g.approveUrl).toBe(`https://shop.example/credentagent/grants/${g.id}`);
    expect(g.terms.budget.eq(usd.dollars(100))).toBe(true);
    expect(g.terms.perSpend.eq(usd.dollars(30))).toBe(true);
    expect(g.terms.merchant).toBe("utopia");
  });

  // Same control as orders.create: the approveUrl is only usable if the grant is READABLE
  // when it's handed out. Delete the `await` on the store write and this goes red.
  it("create() resolves only after the grant is persisted (async store)", async () => {
    const backing = new Map<string, GrantRecord>();
    const slowStore: OrderStore<GrantRecord> = {
      read: async (id) => backing.get(id),
      write: async (id, v) => {
        await new Promise((r) => setTimeout(r, 5));
        backing.set(id, v);
      },
      clear: async (id) => {
        backing.delete(id);
      },
    };
    const ca = new CredentAgent({ walletOrigin: "https://shop.example", grantStore: slowStore });
    const { id } = await ca.grants.create({ ...terms(), policy: [] });
    expect(backing.has(id)).toBe(true);
  });

  it("retrieve() rehydrates by id; an unknown id is a typed not-found, never a throw", async () => {
    const ca = new CredentAgent({ walletOrigin: "https://shop.example" });
    const { id } = await ca.grants.create({ ...terms(), policy: [] });
    const g = await ca.grants.retrieve(id);
    expect(g.status).toBe("pending");
    expect(g.id).toBe(id);
    expect((await ca.grants.retrieve("gr_nope")).status).toBe("not-found");
  });

  it("scopes per grant: two grants are isolated records (invariant 4)", async () => {
    const ca = new CredentAgent({ walletOrigin: "https://shop.example" });
    const a = await ca.grants.create({ ...terms(), policy: [] });
    const b = await ca.grants.create({ ...terms(), policy: [] });
    expect(a.id).not.toBe(b.id);
    expect((await ca.grants.retrieve(a.id)).id).toBe(a.id);
    expect((await ca.grants.retrieve(b.id)).id).toBe(b.id);
  });
});
