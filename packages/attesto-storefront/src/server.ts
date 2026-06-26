// createStorefront() — a runnable minimal storefront in one line.
//
// Stands up an MCP server (browse-products / checkout / get-order-status) over
// HTTP at /mcp, plus a tiny checkout page, around an injected catalog. The
// checkout tool is UNGATED by default; call `store.gate(resolve)` to have it
// surface a `requires` manifest — which is exactly where @openmobilehub/attesto-gate
// mounts on. The adopter writes ~8 lines and never sees the storefront internals:
//
//   const store = createStorefront();
//   const attesto = new Attesto();
//   attesto.mount(store.app);
//   store.gate((order) => attesto.requirements(order, [ required(age.over(21).when(hasAlcohol)) ]));
//   const { url } = await store.listen(3005);   // → add http://localhost:3005/mcp to Goose

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { createOrder, SAMPLE_CATALOG } from "./index.js";
import type { Order, Product } from "./index.js";

/** Given a priced order, return the `requires` manifest (or `undefined` = ungated). */
export type GateResolver = (order: Order) => unknown[] | undefined;

export interface StorefrontOptions {
  /** Products to sell. Defaults to the package's `SAMPLE_CATALOG`. */
  catalog?: Product[];
  /** Origin the checkout links resolve from. Default `http://localhost:<port>`. */
  baseUrl?: string;
}

export interface Storefront {
  /** The Express app — pass it to `attesto.mount(app)`. */
  app: Express;
  catalog: Product[];
  /** Gate the checkout tool: its result gains a `requires` manifest. */
  gate(resolve: GateResolver): void;
  /** Start the HTTP server. Returns the `/mcp` URL to add as a connector. */
  listen(port?: number): Promise<{ url: string; port: number }>;
}

interface StoredOrder extends Order {
  completed: boolean;
}

export function createStorefront(opts: StorefrontOptions = {}): Storefront {
  const catalog = opts.catalog ?? SAMPLE_CATALOG;
  const orders = new Map<string, StoredOrder>();
  let resolveGate: GateResolver | undefined;
  let baseUrl = opts.baseUrl?.replace(/\/+$/, "") ?? "";
  let seq = 0;

  const app = createMcpExpressApp({ host: "0.0.0.0" });

  function buildServer(): McpServer {
    const server = new McpServer({ name: "attesto-storefront", version: "0.1.0" });

    server.registerTool(
      "browse-products",
      {
        title: "Browse products",
        description: "List the storefront catalog (id, name, price, and any age restriction).",
        inputSchema: {},
      },
      async () => {
        const products = catalog.map((p) => ({
          productId: p.id, name: p.name, price: p.price, currency: p.currency,
          ...(p.minimumAge != null ? { minimumAge: p.minimumAge } : {}),
        }));
        return { structuredContent: { products }, content: [{ type: "text", text: JSON.stringify(products, null, 2) }] };
      },
    );

    server.registerTool(
      "checkout",
      {
        title: "Checkout",
        description:
          "Price the items into an order and return a checkout link. If the storefront is gated, also " +
          "returns a `requires` manifest of what the buyer must prove on the checkout page (e.g. age 21+).",
        inputSchema: {
          items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })),
        },
      },
      async ({ items }) => {
        const order = createOrder(items, `ORD-${++seq}`, catalog);
        orders.set(order.id, { ...order, completed: false });
        const checkoutUrl = `${baseUrl}/checkout?order=${order.id}`;
        const requires = resolveGate?.(order); // ← where Attesto mounts on
        const payload = requires?.length
          ? { orderId: order.id, checkoutUrl, requires }
          : { orderId: order.id, checkoutUrl };
        return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
      },
    );

    server.registerTool(
      "get-order-status",
      {
        title: "Order status",
        description: "Report whether an order has been completed on the checkout page.",
        inputSchema: { orderId: z.string() },
      },
      async ({ orderId }) => {
        const o = orders.get(orderId);
        const status = !o ? "unknown" : o.completed ? "completed" : "pending";
        return { structuredContent: { orderId, status }, content: [{ type: "text", text: `Order ${orderId}: ${status}` }] };
      },
    );

    return server;
  }

  // MCP over streamable HTTP (stateless per request), mirroring the reference server.
  app.all("/mcp", async (req: Request, res: Response) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "error" }, id: null });
    }
  });

  // A minimal checkout page. The buyer opens the link; it renders the order and
  // what's required. Completing here is a DEMO stub (no real ceremony) — the real
  // fail-closed verification is provided by attesto.mount() + the reference demo.
  app.get("/checkout", (req: Request, res: Response) => {
    const order = orders.get(String(req.query.order ?? ""));
    if (!order) return res.status(404).type("html").send("<h1>Unknown order</h1>");
    const requires = (resolveGate?.(order) ?? []) as Array<{ label?: string; credential?: string }>;
    const reqList = requires.length
      ? `<ul>${requires.map((r) => `<li>${r.label ?? r.credential}</li>`).join("")}</ul>`
      : "<p>No verification required.</p>";
    res.type("html").send(
      `<!doctype html><meta charset="utf-8"><title>Checkout ${order.id}</title>` +
      `<body style="font-family:system-ui;max-width:32rem;margin:3rem auto">` +
      `<h1>Checkout — ${order.id}</h1>` +
      `<p>${order.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")} — <b>${order.total} ${order.currency}</b></p>` +
      `<h3>Required to complete</h3>${reqList}` +
      `<form method="post" action="/checkout/place-order"><input type="hidden" name="order" value="${order.id}">` +
      `<button style="padding:.6rem 1rem">Complete purchase (demo)</button></form>` +
      `<p style="color:#888;font-size:.85rem">Demo stub — real fail-closed verification is provided by ` +
      `<code>attesto.mount()</code> and the reference demo.</p></body>`,
    );
  });
  app.post("/checkout/place-order", (req: Request, res: Response) => {
    const o = orders.get(String(req.body?.order ?? ""));
    if (o) o.completed = true;
    res.type("html").send(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:32rem;margin:3rem auto"><h1>✓ Order placed (demo)</h1><p>You can close this tab.</p></body>`);
  });

  return {
    app,
    catalog,
    gate(resolve: GateResolver) { resolveGate = resolve; },
    async listen(port = 3005): Promise<{ url: string; port: number }> {
      if (!baseUrl) baseUrl = `http://localhost:${port}`;
      await new Promise<void>((resolve) => { app.listen(port, () => resolve()); });
      return { url: `${baseUrl}/mcp`, port };
    },
  };
}
