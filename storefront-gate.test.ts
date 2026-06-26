import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createStorefront, type Storefront } from "@openmobilehub/attesto-storefront/server";
import { Attesto, age, membership, payment, required, optional } from "@openmobilehub/attesto-gate";

// Guards the quickstart showcase (examples/storefront.mjs): the two packages
// compose with ZERO glue — a priced storefront Order feeds attesto.requirements()
// directly (the line carries minimumAge), and the checkout tool surfaces the
// manifest. Drives the real MCP server over an in-memory transport (deterministic).

const hasAlcohol = (order: { lines: { minimumAge?: number }[] }) =>
  order.lines.some((l) => l.minimumAge != null);

function gatedStore(): Storefront {
  const store = createStorefront();
  const attesto = new Attesto();
  attesto.mount(store.app);
  store.gate((order) =>
    attesto.requirements(order, [
      required(age.over(21).when(hasAlcohol)),
      optional(membership.discount(10)),
      required(payment.in("usd")),
    ]),
  );
  return store;
}

async function connect(store: Storefront): Promise<Client> {
  const server = store.mcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "compose-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const checkout = (c: Client, productId: string) =>
  c.callTool({ name: "checkout", arguments: { items: [{ productId, quantity: 1 }] } });

describe("attesto-storefront × attesto-gate compose (zero glue)", () => {
  it("registers the storefront tools", async () => {
    const tools = (await (await connect(gatedStore())).listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["browse-products", "checkout", "get-order-status"]));
  });

  it("alcohol cart → checkout surfaces the age gate + a checkoutUrl; payment settles last", async () => {
    const res = await checkout(await connect(gatedStore()), "oak-whiskey");
    const sc = res.structuredContent as { checkoutUrl: string; requires: Array<{ credential: string; minAge?: number }> };
    expect(sc.checkoutUrl).toContain("/checkout?order=");
    const order = sc.requires.map((e) => e.credential);
    expect(order).toEqual(["age", "membership", "payment"]); // declared order, payment last
    expect(sc.requires.find((e) => e.credential === "age")!.minAge).toBe(21);
  });

  it("non-alcohol cart → no age entry (the .when() predicate drops it)", async () => {
    const res = await checkout(await connect(gatedStore()), "aurora-headphones");
    const sc = res.structuredContent as { requires: Array<{ credential: string }> };
    expect(sc.requires.find((e) => e.credential === "age")).toBeUndefined();
    expect(sc.requires.map((e) => e.credential)).toEqual(["membership", "payment"]);
  });

  it("ungated storefront → plain checkout link, no `requires`", async () => {
    const res = await checkout(await connect(createStorefront()), "oak-whiskey");
    const sc = res.structuredContent as { checkoutUrl: string; requires?: unknown };
    expect(sc.checkoutUrl).toContain("/checkout?order=");
    expect(sc.requires).toBeUndefined();
  });
});
