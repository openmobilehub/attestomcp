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
// Amounts are integer minor units (cents) end-to-end internally — the catalog is priced in
// cents, the sealed bounds and every draw amount are integer cents, so the engine's numeric
// caps compare exact integers (no binary-float drift on an exact-budget boundary). The public
// surface is `Money`; the caller never sees a raw scalar.

import { webcrypto } from "node:crypto";
import type { Credential, GateOrder, Step, VerificationManifestEntry } from "./types.js";
import type { OrderStore, CompletedOrder } from "./orders.js";
import type { CeremonyCatalog, CeremonyOrder } from "./ceremony/types.js";
import type { RevocationStore } from "./ceremony/revocation.js";
import { sealIntent, signDraw, type IntentBounds, type DelegateJwk } from "./ceremony/mandate.js";
import { completeOrder, type CompletedRecord } from "./ceremony/completion.js";
import { MemoryVerificationStore } from "./store.js";
import { usd, type Money } from "./money.js";

const { subtle } = webcrypto;

/** The delegate PRIVATE key as a JWK — server-held custody (trust_level "server-issued-demo").
 *  Unlike `DelegatedGate` (in-process, non-extractable key), a grant must rehydrate in a
 *  DIFFERENT process (`grants.retrieve` in a worker — spec 009 FR-007), so the key rides in
 *  the grant store. The wallet-custody increment moves it to the user's wallet. */
export interface DelegatePrivateJwk extends DelegateJwk {
  d: string;
}

/** A priced catalog entry: a bare price (dollars), or a price plus an age restriction. */
export type CatalogEntry = number | { price: number; minAge?: number };

/** The grant trust rung — server-minted key, dev-sealed mandate, no real settlement. Kept out
 *  of the shared `TrustLevel` union (that names the OpenID4VP presence rails); grants are a
 *  distinct, weaker honesty claim, spelled out so a typo can't pass as a stronger level. */
export type GrantTrustLevel = "server-issued-demo";

/** The whole spend-code vocabulary the door can return (a closed set the caller can switch on). */
export type SpendCode =
  | "budget-exceeded"       // cumulative budget would be exceeded (engine over-total)
  | "per-spend-exceeded"    // one purchase over the per-spend cap (engine over-cap)
  | "not-authorized"        // grant is pending — the human has not approved yet
  | "denied"                // the human declined the grant — terminal
  | "revoked"               // the grant was revoked — terminal
  | "step-up"               // age / custom-gated item — a live human must approve
  | "invalid-quantity"      // a per-item quantity that isn't a positive integer
  | "idempotency-conflict"  // same idempotencyKey, different items (Stripe's rule)
  | "not-found"             // no such grant
  | (string & {});          // pass-through engine refusal codes (forward-compatible)

const centsOf = (m: Money): number => m.serialize().amount;

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

/** The stored record — the server-side authority for terms + lifecycle (invariant 2/4).
 *  Amounts are integer cents. */
export interface GrantRecord {
  id: string;
  merchant: string;
  budgetCents: number;
  perSpendCents: number;
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

/** The signed records a completed spend carries. Stored in the completed record's
 *  `mandateBundle` so a replay echoes it and can detect a parameter conflict. */
interface SpendBundle {
  intentMandate: IntentBounds;
  draw: unknown;
  /** A fingerprint of the spent items — replaying the SAME key with DIFFERENT items conflicts. */
  fingerprint: string;
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
      trustLevel: GrantTrustLevel;
      mandateBundle: { intentMandate: IntentBounds; draw: unknown };
    }
  | {
      ok: false;
      code: SpendCode;
      remaining: Money;
      retryable?: "retry" | "needs-human" | "terminal";
      trustLevel: GrantTrustLevel;
    };

export interface GrantsDeps {
  walletOrigin: string;
  store: OrderStore<GrantRecord>;
  revocation: RevocationStore;
  /** The client's priced catalog map (spec FR-001) — required for `spend()`, not create/retrieve. */
  catalog?: Record<string, CatalogEntry>;
  requirements: (order: GateOrder, policy: Step[]) => VerificationManifestEntry[];
  /** Route a completed spend through `orders._complete` — settled event + webhooks for free. */
  completeSpend: (record: CompletedOrder) => Promise<void>;
  /** Read a spend's completion (replay detection) — the orders completed store. */
  readSpend: (orderId: string) => Promise<CompletedOrder | undefined> | CompletedOrder | undefined;
  /** The client's credential registry, so the spend path enforces custom gate()s (007/inv. 1). */
  credentialRegistry?: ReadonlyMap<string, Credential>;
  /** Wire the approve page + rails onto an Express app — `grants.serve(app)` (set in client). */
  serve?: (app: unknown) => void;
}

const genId = (): string => `gr_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const TRUST: GrantTrustLevel = "server-issued-demo";
const priceOf = (e: CatalogEntry): number => (typeof e === "number" ? e : e.price);
const minAgeOf = (e: CatalogEntry): number | undefined => (typeof e === "number" ? undefined : e.minAge);
const fingerprintOf = (items: SpendItem[]): string =>
  JSON.stringify(items.map((i) => [i.sku, i.qty ?? 1]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/** Build a re-pricing catalog seam in INTEGER CENTS from the plain dollar-priced map. An unknown
 *  item is a programming error (throws, fail fast), NOT a gate decision. */
function centsCatalog(items: Record<string, CatalogEntry>): CeremonyCatalog {
  return {
    createOrder(refs, orderId): CeremonyOrder {
      const lines = refs.map(({ productId, quantity }) => {
        const entry = items[productId];
        if (entry === undefined) {
          throw new Error(`[credentagent] unknown catalog item "${productId}". Known items: ${Object.keys(items).join(", ")}.`);
        }
        const unitPrice = Math.round(priceOf(entry) * 100); // cents — exact integers downstream
        const minimumAge = minAgeOf(entry);
        return { id: productId, unitPrice, quantity, lineTotal: unitPrice * quantity, currency: "USD", ...(minimumAge ? { minimumAge } : {}) };
      });
      const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);
      return { id: orderId, lines, itemCount: refs.length, subtotal: total, discount: 0, total, currency: "USD" };
    },
  };
}

/** A tiny per-key async mutex: serializes lifecycle + spend transitions PER GRANT in-process,
 *  so a create/authorize/decline/revoke/spend can't interleave with another on the same grant
 *  (the read-check-write TOCTOU class — REVIEW.md §1/§2). Cross-process serialization is out of
 *  scope for this in-process increment; budget safety there still rides on the engine's atomic
 *  single-use consume, and lifecycle CAS is a wallet-custody-increment concern. */
class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // Keep the chain going but don't leak rejections into the next waiter's scheduling.
    this.tails.set(key, next.then(() => undefined, () => undefined));
    return next;
  }
}

export class Grants {
  private readonly locks = new KeyedMutex();

  constructor(private readonly deps: GrantsDeps) {}

  /** Open a grant awaiting the human's one-time approval. Persisted BEFORE the URL is handed out. */
  async create(opts: CreateGrantOptions): Promise<Grant> {
    // Configure-time programming errors throw (matching Money's own constructor), not refuse:
    for (const [name, m] of [["budget", opts.budget], ["perSpend", opts.perSpend]] as const) {
      if (!m || typeof (m as Money).serialize !== "function") throw new Error(`[credentagent] grants.create: ${name} must be a Money (e.g. usd.dollars(100)).`);
      const { amount, currency } = m.serialize();
      if (currency !== "usd") throw new Error(`[credentagent] grants.create: ${name} must be USD (got ${currency}).`);
      if (!(amount > 0)) throw new Error(`[credentagent] grants.create: ${name} must be a positive amount (got ${amount} cents).`);
    }
    const id = genId();
    const record: GrantRecord = {
      id,
      merchant: opts.merchant,
      budgetCents: centsOf(opts.budget),
      perSpendCents: centsOf(opts.perSpend),
      currency: "USD",
      ...(opts.description ? { description: opts.description } : {}),
      policy: opts.policy,
      status: "pending",
    };
    await this.deps.store.write(id, record);
    return new Grant(record, this.deps, this.locks);
  }

  /** Rehydrate a grant by id. Unknown ids answer with a typed `not-found` handle — no throw. */
  async retrieve(id: string): Promise<Grant> {
    const record = await this.deps.store.read(id);
    if (!record) return Grant.notFound(id, this.deps, this.locks);
    return new Grant(record, this.deps, this.locks);
  }

  /** Wire the approve page (each grant's `approveUrl`) + ceremony rails onto your app. */
  serve(app: unknown): void {
    if (!this.deps.serve) throw new Error("[credentagent] grants.serve(app) is not wired on this client.");
    this.deps.serve(app);
  }

  /** Called by the approve ceremony when the human approves — seals the AP2 Intent Mandate
   *  (dev-sealed, trust_level "server-issued-demo"), mints the delegate key, flips status to
   *  "authorized". Serialized per grant by the KeyedMutex, so the read-check-write is atomic
   *  w.r.t. every other transition on this grant — a concurrent revoke/decline or a double-POST
   *  can't interleave, and only a STILL-pending grant seals (never resurrecting a stopped one). */
  async _authorize(id: string): Promise<void> {
    await this.locks.run(id, async () => {
      const record = await this.deps.store.read(id);
      if (!record || record.status !== "pending") return;
      const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const pub = await subtle.exportKey("jwk", pair.publicKey);
      const priv = (await subtle.exportKey("jwk", pair.privateKey)) as DelegatePrivateJwk;
      const delegate: DelegateJwk = { kty: "EC", crv: "P-256", x: pub.x!, y: pub.y! };
      const intent = await sealIntent({
        type: "credentagent.IntentBounds/v0",
        ...(record.description ? { naturalLanguageDescription: record.description } : {}),
        merchants: [record.merchant],
        currency: record.currency,
        maxAmount: record.perSpendCents,
        totalAmount: record.budgetCents,
        delegate,
        presence: "delegated-demo",
        trust_level: "server-issued-demo",
      });
      await this.deps.store.write(id, { ...record, status: "authorized", intent, delegateJwk: priv });
    });
  }

  /** Called by the approve page's decline — pending → denied; every other state is a no-op
   *  (fail-closed: an authorized grant is stopped by `revoke()`, never silently re-labelled). */
  async _decline(id: string): Promise<void> {
    await this.locks.run(id, async () => {
      const record = await this.deps.store.read(id);
      if (!record || record.status !== "pending") return;
      await this.deps.store.write(id, { ...record, status: "denied" });
    });
  }
}

/**
 * A grant handle. Status is a retrieve-time snapshot for display; `spend()`/`revoke()`
 * ALWAYS re-read the stored record under the per-grant lock, so a stale handle can never
 * bypass a revocation or double-spend.
 */
export class Grant {
  private snapshotStatus: GrantStatus;

  constructor(
    private readonly record: GrantRecord | undefined,
    private readonly deps: GrantsDeps,
    private readonly locks: KeyedMutex,
    private readonly missingId?: string,
  ) {
    this.snapshotStatus = record ? record.status : "not-found";
  }

  static notFound(id: string, deps: GrantsDeps, locks: KeyedMutex): Grant {
    return new Grant(undefined, deps, locks, id);
  }

  get id(): string {
    return this.record?.id ?? this.missingId!;
  }

  get status(): GrantStatus {
    return this.snapshotStatus;
  }

  /** The approve link — `undefined` for a not-found handle (there is nothing to approve). */
  get approveUrl(): string | undefined {
    if (!this.record) return undefined;
    return `${this.deps.walletOrigin}/credentagent/grants/${this.id}`;
  }

  /** The terms as Money — `undefined` for a not-found handle (never throws). */
  get terms(): { merchant: string; budget: Money; perSpend: Money; description?: string } | undefined {
    const r = this.record;
    if (!r) return undefined;
    return {
      merchant: r.merchant,
      budget: usd.cents(r.budgetCents),
      perSpend: usd.cents(r.perSpendCents),
      ...(r.description ? { description: r.description } : {}),
    };
  }

  /** The AP2 Intent Mandate this grant carries — sealed at authorize, absent while pending. */
  get intentMandate(): IntentBounds | undefined {
    return this.record?.intent;
  }

  get trustLevel(): GrantTrustLevel {
    return TRUST;
  }

  /**
   * Revoke the grant — the kill switch. Writes BOTH authorities: the revocation store
   * (what the draw engine checks — a stale handle can never spend past it) AND the stored
   * status (what retrieve()/UIs read). Re-reads after the status write and revokes any intent
   * that appeared (covers a revoke racing an authorize). A revoked grant is never resurrected.
   */
  async revoke(): Promise<void> {
    await this.locks.run(this.id, async () => {
      const record = await this.deps.store.read(this.id);
      if (!record) return;
      if (record.intent) await this.deps.revocation.revoke(record.intent.intentId);
      await this.deps.store.write(this.id, { ...record, status: "revoked" });
      // A concurrent authorize may have sealed an intent between our read and write; revoke it too.
      const after = await this.deps.store.read(this.id);
      if (after?.intent && after.intent.intentId !== record.intent?.intentId) {
        await this.deps.revocation.revoke(after.intent.intentId);
      }
      this.snapshotStatus = "revoked";
    });
  }

  /** Budget headroom in cents from the committed-draw ledger (the revocation store is the authority). */
  private async committedCents(intent: IntentBounds): Promise<number> {
    const committed = await this.deps.revocation.priorDraws(intent.intentId);
    return committed.reduce((sum, d) => sum + d.amount, 0);
  }

  /**
   * Spend against the grant while the human is away. Refusals are DATA (`{ ok:false, code }`),
   * never throws; a throw is a programming error (bad idempotencyKey, empty items, unknown sku,
   * missing catalog config). Serialized per grant, so the replay pre-read and the atomic draw
   * commit can't interleave with another spend on the same grant.
   */
  async spend({ idempotencyKey, items }: { idempotencyKey: string; items: SpendItem[] }): Promise<SpendDoor> {
    // Programming-error guards (throw — a caller can't recover these by branching on a code):
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim() === "") {
      throw new Error("[credentagent] grant.spend: idempotencyKey must be a non-empty string (a stable per-purchase key; reuse it to retry safely).");
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("[credentagent] grant.spend: items must be a non-empty array of { sku, qty? }.");
    }

    return this.locks.run(this.id, async () => {
      const record = await this.deps.store.read(this.id);
      if (!record) return refuse("not-found", usd.cents(0), "terminal");

      const orderId = `${this.id}-${idempotencyKey}`;

      // Replay BEFORE the lifecycle gates: a settled spend is history — revocation stops NEW
      // draws, it does not rewrite a charge that already completed (#104 decision 1). A replay
      // with DIFFERENT items for the same key is a conflict (Stripe's idempotency rule).
      const prior = await this.deps.readSpend(orderId);
      if (prior) {
        const bundle = prior.mandateBundle as SpendBundle | undefined;
        if (bundle?.fingerprint && bundle.fingerprint !== fingerprintOf(items)) {
          return refuse("idempotency-conflict", await this.remaining(record), "terminal");
        }
        return {
          ok: true as const,
          amount: usd.dollars(prior.amount ?? 0), // the completed store holds dollars (see records.write)
          remaining: await this.remaining(record),
          replayed: true as const,
          authorization: "delegated" as const,
          trustLevel: TRUST,
          mandateBundle: bundle ? { intentMandate: bundle.intentMandate, draw: bundle.draw } : { intentMandate: record.intent!, draw: undefined },
        };
      }

      // Lifecycle gates (each a distinct, actionable code):
      const rem = await this.remaining(record);
      if (record.status === "revoked") return refuse("revoked", rem, "terminal");
      if (record.status === "denied") return refuse("denied", rem, "terminal");
      if (record.status !== "authorized" || !record.intent || !record.delegateJwk) return refuse("not-authorized", rem, "needs-human");

      if (!this.deps.catalog) {
        throw new Error(
          "[credentagent] grants: no catalog configured. Pass `new CredentAgent({ catalog: { sku: price, ... } })` — spends are re-priced server-side from it (a caller never passes an amount).",
        );
      }

      // Every quantity must be a positive integer — otherwise a fractional or negative qty
      // would price BELOW the catalog cost (a hidden discount) and still bind (invariant 2/3).
      for (const it of items) {
        const q = it.qty ?? 1;
        if (!Number.isInteger(q) || q <= 0) return refuse("invalid-quantity", rem, "terminal");
      }

      const catalog = centsCatalog(this.deps.catalog);
      const order = catalog.createOrder(items.map((i) => ({ productId: i.sku, quantity: i.qty ?? 1 })), orderId);
      const key = await subtle.importKey("jwk", record.delegateJwk as webcrypto.JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      const draw = await signDraw(
        {
          type: "credentagent.Draw/v0",
          intentId: record.intent.intentId,
          paymentMandateId: idempotencyKey,
          merchant: record.merchant,
          amount: order.total,
          currency: record.currency,
          pspTransactionId: idempotencyKey,
        },
        key,
      );
      const bundle: SpendBundle = { intentMandate: record.intent, draw, fingerprint: fingerprintOf(items) };
      const records = {
        read: async (oid: string): Promise<CompletedRecord | undefined> => {
          const done = await this.deps.readSpend(oid);
          if (!done) return undefined;
          return { orderId: oid, mandateId: done.txId ?? "", amount: done.amount ?? 0, currency: done.currency ?? "", method: done.method ?? "", gates: [], completedAt: done.completedAt ?? "" };
        },
        write: async (r: CompletedRecord): Promise<void> => {
          // Store the settled amount in DOLLARS in the completed-order store, so a webhook /
          // order.settled consumer sees the same unit for a grant spend as for a human-present
          // order (the record is shared). Internal draw math stays in cents; r.amount is cents.
          await this.deps.completeSpend({ orderId: r.orderId, amount: r.amount / 100, currency: r.currency, method: r.method, completedAt: r.completedAt, mandateBundle: bundle });
        },
      };
      const res = await completeOrder(
        { order, mandateId: idempotencyKey, amount: order.total, currency: record.currency, method: "delegated", gates: [], draw: { intent: record.intent, draw } },
        {
          catalog,
          revocation: this.deps.revocation,
          verificationStore: new MemoryVerificationStore(),
          records,
          ...(this.deps.credentialRegistry ? { credentialRegistry: this.deps.credentialRegistry } : {}),
        },
      );
      const after = await this.remaining(record);
      if (res.completed) {
        return { ok: true as const, amount: usd.cents(order.total), remaining: after, authorization: "delegated" as const, trustLevel: TRUST, mandateBundle: { intentMandate: record.intent, draw } };
      }
      const refusal = res.refusals?.[0];
      const code: SpendCode = refusal?.code === "over-total" ? "budget-exceeded" : refusal?.code === "over-cap" ? "per-spend-exceeded" : (refusal?.code ?? "refused");
      return { ok: false as const, code, remaining: after, ...(refusal?.retryable ? { retryable: refusal.retryable } : {}), trustLevel: TRUST };
    });
  }

  /** Budget headroom as Money. */
  private async remaining(record: GrantRecord): Promise<Money> {
    if (!record.intent) return usd.cents(record.budgetCents);
    return usd.cents(record.budgetCents - (await this.committedCents(record.intent)));
  }
}

function refuse(code: SpendCode, remaining: Money, retryable: "retry" | "needs-human" | "terminal"): SpendDoor {
  return { ok: false, code, remaining, retryable, trustLevel: TRUST };
}
