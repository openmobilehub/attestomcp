// credentagent.orders — the human-present checkout resource (spec 009).
//
//   const { id, approveUrl, manifest } = credentagent.orders.create({ order, policy });
//   // hand approveUrl to the human; they prove on the checkout page (renderRequirements + the rails).
//   const res = await credentagent.orders.retrieve(id);   // the DOOR: ok | pending+approveUrl | reason
//
// It wraps machinery the gate already has: requirements() (the manifest), the ceremony
// rails + renderRequirements() (the approveUrl page), and completeOrder() (whose write to the
// completed-order store IS the `order.settled` webhook — FR-009, never a poll loop).
//
// Stores default to in-memory and are per-order keyed (Security invariant 4 — never
// process-global); inject a shared store (Redis) for multi-instance deploys.

import type { GateOrder, Step, VerificationManifestEntry, TrustLevel } from "./types.js";

/** A created-but-not-yet-completed order: the inputs the door + page re-derive from. */
export interface CreatedOrder {
  order: GateOrder;
  policy: Step[];
}

/** The lean record completeOrder writes when an order finishes (mirrors the storefront shape). */
export interface CompletedOrder {
  orderId: string;
  amount?: number;
  currency?: string;
  method?: string;
  txId?: string;
  network?: string;
  completedAt?: string;
  /** The signed AP2 records, when the completion path surfaces them. */
  mandateBundle?: unknown;
}

/** Minimal per-order KV, mirroring VerificationStore. In-memory default; inject for prod. */
export interface OrderStore<T> {
  read(id: string): T | undefined | Promise<T | undefined>;
  write(id: string, value: T): void | Promise<void>;
  clear(id: string): void | Promise<void>;
}

export class MemoryOrderStore<T> implements OrderStore<T> {
  private readonly m = new Map<string, T>();
  read(id: string): T | undefined { return this.m.get(id); }
  write(id: string, value: T): void { this.m.set(id, value); }
  clear(id: string): void { this.m.delete(id); }
}

/** The one result shape every consent path shares (spec 009 FR-003). */
export type OrderDoor =
  | { ok: true; mandateBundle?: unknown; authorization: "direct"; trustLevel: TrustLevel; completion: Omit<CompletedOrder, "orderId" | "mandateBundle"> }
  | { ok: false; pending: true; approveUrl: string; trustLevel: TrustLevel }
  | { ok: false; code: string; credential?: string; trustLevel: TrustLevel };

export interface OrdersDeps {
  walletOrigin: string;
  /** Resolve the policy to the serializable manifest (CredentAgent.requirements). */
  requirements: (order: GateOrder, policy: Step[]) => VerificationManifestEntry[];
  created: OrderStore<CreatedOrder>;
  /** The completed-order store; its write() fires "order.settled". */
  completed: OrderStore<CompletedOrder>;
  emit: (event: "order.settled", payload: { id: string }) => void;
  /** Wire the checkout (rails + page + completion) onto an Express app — `orders.serve(app)`. */
  serve: (app: unknown) => void;
}

const genId = (): string => `ord_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const TRUST: TrustLevel = "presence-only-demo";

export class Orders {
  constructor(private readonly deps: OrdersDeps) {}

  /** Open an order that needs consent. Returns the id, the approve link, and the manifest. */
  create({ order, policy }: { order: GateOrder; policy: Step[] }): {
    id: string;
    approveUrl: string;
    manifest: VerificationManifestEntry[];
  } {
    const id = order.id && order.id.trim() !== "" ? order.id : genId();
    const withId: GateOrder = { ...order, id };
    const manifest = this.deps.requirements(withId, policy);   // re-priced/resolved server-side (invariant 2)
    void this.deps.created.write(id, { order: withId, policy });
    return { id, approveUrl: `${this.deps.walletOrigin}/credentagent/orders/${id}`, manifest };
  }

  /** Read the current outcome — a single call (use in an order.settled handler, never a poll loop). */
  async retrieve(id: string): Promise<OrderDoor> {
    const done = await this.deps.completed.read(id);
    if (done) {
      const { orderId: _o, mandateBundle, ...completion } = done;
      return { ok: true, authorization: "direct", trustLevel: TRUST, ...(mandateBundle !== undefined ? { mandateBundle } : {}), completion };
    }
    const created = await this.deps.created.read(id);
    if (created) return { ok: false, pending: true, approveUrl: `${this.deps.walletOrigin}/credentagent/orders/${id}`, trustLevel: TRUST };
    return { ok: false, code: "not-found", trustLevel: TRUST };
  }

  /**
   * Wire the checkout onto your Express app in one call: the ceremony rails, the checkout
   * page at each order's `approveUrl` (`/credentagent/orders/:id`), and completion — a
   * finished ceremony records the order and fires `order.settled`. No seams to assemble.
   *
   *   ca.orders.serve(app);
   *   ca.on("order.settled", ({ id }) => fulfill(id));
   *   const { approveUrl } = ca.orders.create({ order, policy });
   */
  serve(app: unknown): void {
    this.deps.serve(app);
  }

  /** Called by the completion path when an order finishes — records it and fires the webhook. */
  async _complete(record: CompletedOrder): Promise<void> {
    await this.deps.completed.write(record.orderId, record);
    this.deps.emit("order.settled", { id: record.orderId });
  }
}
