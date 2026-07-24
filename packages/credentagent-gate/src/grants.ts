// credentagent.grants — durable spend authority (spec 009, the human-not-present half; #104).
//
//   const grant = await credentagent.grants.create({ merchant, budget: usd.dollars(100), perSpend: usd.dollars(30), policy });
//   sendToUser(grant.approveUrl);                                  // the human approves the LIMIT once
//   // later, from a worker — human away:
//   const grant = await credentagent.grants.retrieve(id);          // status: pending|authorized|denied|revoked|not-found
//   const s = await grant.spend({ idempotencyKey, items: [{ sku: "coffee", qty: 1 }] });
//
// A grant is the durable authority handle (status, remaining, spend, revoke); the AP2
// Intent Mandate is the sealed artifact it CARRIES (`grant.intentMandate`), produced at the
// authorize ceremony — two layers, two names (maintainer decision, 2026-07-23).
//
// Honesty (constitution VII): the delegate key is minted SERVER-side at authorize, so grants
// carry trust_level "server-issued-demo" — no real value settles, and the wallet-custody
// increment swaps the internals without changing this surface. Age and custom gate()
// credentials are NON-delegable: the shared completion seam steps them up to a live human.
//
// This is the ONE seam where Money converts to the repo's dollar-number amounts
// (GateOrder / IntentBounds / catalog prices): `dollarsOf()` below. Nowhere else.

import type { GateOrder, Step, VerificationManifestEntry } from "./types.js";
import type { OrderStore, CompletedOrder } from "./orders.js";
import type { CeremonyCatalog } from "./ceremony/types.js";
import type { RevocationStore } from "./ceremony/revocation.js";
import type { IntentBounds, DelegateJwk } from "./ceremony/mandate.js";
import { usd, type Money } from "./money.js";

/** The delegate PRIVATE key as a JWK — server-held custody (trust_level "server-issued-demo").
 *  Unlike `DelegatedGate` (in-process, non-extractable key), a grant must rehydrate in a
 *  DIFFERENT process (`grants.retrieve` in a worker — spec 009 FR-007), so the key rides in
 *  the grant store. The wallet-custody increment moves it to the user's wallet. */
export interface DelegatePrivateJwk extends DelegateJwk {
  d: string;
}

/** The one Money → dollar-number conversion in the package (see header). */
const dollarsOf = (m: Money): number => m.serialize().amount / 100;

/** What the caller passes to `grants.create()`. Amounts are Money — never raw scalars. */
export interface CreateGrantOptions {
  /** The one merchant this grant may spend at. */
  merchant: string;
  /** Cumulative lifetime cap across every spend (does not reset). */
  budget: Money;
  /** Per-spend ceiling (an absolute cap). */
  perSpend: Money;
  /** Credential policy the human must satisfy at the authorize ceremony. `[]` ⇒ ungated. */
  policy: Step[];
  /** A human sentence describing the grant (shown on the approve page). */
  description?: string;
}

export type GrantStatus = "pending" | "authorized" | "denied" | "revoked" | "not-found";

/** The stored record — the server-side authority for terms + lifecycle (invariant 2/4). */
export interface GrantRecord {
  id: string;
  merchant: string;
  /** Dollars (converted from Money ONCE at create — see `dollarsOf`). */
  budgetDollars: number;
  perSpendDollars: number;
  currency: "USD";
  description?: string;
  policy: Step[];
  status: Exclude<GrantStatus, "not-found">;
  /** Sealed at authorize (dev-sealed, trust_level server-issued-demo). */
  intent?: IntentBounds;
  /** The delegate PRIVATE key, server-held (server-issued-demo; wallet-custody swaps this). */
  delegateJwk?: DelegatePrivateJwk;
}

export interface SpendItem {
  sku: string;
  qty?: number;
}

/** One result door for every spend (spec 009 FR-003). */
export type SpendDoor =
  | {
      ok: true;
      /** The catalog-priced amount of THIS spend (never trusted from the caller). */
      amount: Money;
      /** Headroom left on the budget AFTER this spend. */
      remaining: Money;
      /** True when this call safely replayed an already-completed spend (same idempotencyKey). */
      replayed?: true;
      authorization: "delegated";
      trustLevel: string;
      mandateBundle: { intentMandate: IntentBounds; draw: unknown };
    }
  | {
      ok: false;
      /** "budget-exceeded" | "per-spend-exceeded" | "revoked" | "not-authorized" | "step-up" | … */
      code: string;
      remaining: Money;
      retryable?: "retry" | "needs-human" | "terminal";
      trustLevel: string;
    };

export interface GrantsDeps {
  walletOrigin: string;
  store: OrderStore<GrantRecord>;
  revocation: RevocationStore;
  /** The client's priced catalog (spec FR-001) — required for `spend()`, not for create/retrieve. */
  catalog?: CeremonyCatalog;
  requirements: (order: GateOrder, policy: Step[]) => VerificationManifestEntry[];
  /** Route a completed spend through `orders._complete` — settled event + webhooks for free. */
  completeSpend: (record: CompletedOrder) => Promise<void>;
  /** Read a spend's completion (replay detection) — the orders completed store. */
  readSpend: (orderId: string) => Promise<CompletedOrder | undefined> | CompletedOrder | undefined;
  /** Wire the approve page + rails onto an Express app — `grants.serve(app)` (set in client). */
  serve?: (app: unknown) => void;
}

const genId = (): string => `gr_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const TRUST_PENDING = "server-issued-demo";

export class Grants {
  constructor(private readonly deps: GrantsDeps) {}

  /** Open a grant awaiting the human's one-time approval. Persisted BEFORE the URL is handed out. */
  async create(opts: CreateGrantOptions): Promise<Grant> {
    const id = genId();
    const record: GrantRecord = {
      id,
      merchant: opts.merchant,
      budgetDollars: dollarsOf(opts.budget),
      perSpendDollars: dollarsOf(opts.perSpend),
      currency: "USD",
      ...(opts.description ? { description: opts.description } : {}),
      policy: opts.policy,
      status: "pending",
    };
    await this.deps.store.write(id, record);
    return new Grant(record, this.deps);
  }

  /** Rehydrate a grant by id. Unknown ids answer with a typed `not-found` handle — no throw. */
  async retrieve(id: string): Promise<Grant> {
    const record = await this.deps.store.read(id);
    if (!record) return Grant.notFound(id, this.deps);
    return new Grant(record, this.deps);
  }

  /** Wire the approve page (each grant's `approveUrl`) + ceremony rails onto your app. */
  serve(app: unknown): void {
    if (!this.deps.serve) throw new Error("[credentagent] grants.serve(app) is not wired on this client.");
    this.deps.serve(app);
  }
}

/**
 * A grant handle. Status is a retrieve-time snapshot for display; `spend()`/`revoke()`
 * ALWAYS re-read the stored record, so a stale handle can never bypass a revocation.
 */
export class Grant {
  private constructorStatus: GrantStatus;

  constructor(
    private readonly record: GrantRecord | undefined,
    private readonly deps: GrantsDeps,
    private readonly missingId?: string,
  ) {
    this.constructorStatus = record ? record.status : "not-found";
  }

  static notFound(id: string, deps: GrantsDeps): Grant {
    return new Grant(undefined, deps, id);
  }

  get id(): string {
    return this.record?.id ?? this.missingId!;
  }

  get status(): GrantStatus {
    return this.constructorStatus;
  }

  get approveUrl(): string {
    return `${this.deps.walletOrigin}/credentagent/grants/${this.id}`;
  }

  /** The terms as Money — the raw dollar numbers stay server-side. */
  get terms(): { merchant: string; budget: Money; perSpend: Money; description?: string } {
    const r = this.requireRecord();
    return {
      merchant: r.merchant,
      budget: usd.dollars(r.budgetDollars),
      perSpend: usd.dollars(r.perSpendDollars),
      ...(r.description ? { description: r.description } : {}),
    };
  }

  /** The AP2 Intent Mandate this grant carries — sealed at authorize, absent while pending. */
  get intentMandate(): IntentBounds | undefined {
    return this.record?.intent;
  }

  get trustLevel(): string {
    return this.record?.intent?.trust_level ?? TRUST_PENDING;
  }

  private requireRecord(): GrantRecord {
    if (!this.record) throw new Error(`[credentagent] grant ${this.missingId} not found.`);
    return this.record;
  }
}
