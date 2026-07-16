// @openmobilehub/credentagent-gate — public types (the contract, in TypeScript).
//
// Two layers (see specs/001-attesto-sdk/data-model.md):
//   • policy   — code: builders carry functions (.when / verify / appliesTo) and live in your server.
//   • manifest — data: `requirements()` resolves the policy server-side and emits a flat, JSON-safe
//                manifest. Functions NEVER cross the wire. `requirements()` is that code→data boundary.

// ── DCQL (what to ask the wallet) ──────────────────────────────────────────

export interface DcqlClaim {
  path: string[];
  intent_to_retain?: boolean;
}
export interface DcqlCredentialOption {
  id: string;
  format: "mso_mdoc";
  meta: Record<string, string>;
  claims: DcqlClaim[];
}
export interface DcqlQuery {
  credentials: DcqlCredentialOption[];
}

// ── Trust (honesty axis — Principle VII) ───────────────────────────────────

/**
 * How honestly the presented mdoc is trusted. v0.1 enforces *disclosure*
 * (explicit positive claim) and *binding* (nonce / ephemeral key), but NOT
 * *trust* (issuer / device signatures) — a self-crafted mdoc would pass. The
 * manifest and the envelope both carry this so the limitation is stated in the
 * type, not buried in prose: it's a flow demo, not a real safety control yet.
 */
export type TrustLevel = "presence-only-demo" | "issuer-verified";

// ── Effects (tagged data the resolver interprets — never a handler in v0.1) ──

export type Effect =
  | { kind: "gate" }
  | { kind: "discount"; percent?: number; amount?: number }
  | { kind: "authorize" };

// ── Order (input to requirements — re-derived server-side, never the token) ──

export interface OrderLine {
  /** Product id. */
  id: string;
  /** Quantity (matches the demo's `PricedCartLine.quantity`). */
  quantity: number;
  /** Cents; authoritative (catalog). */
  unitPrice: number;
  /**
   * Per-product age threshold (21 for alcohol), re-derived server-side onto the
   * line from the catalog (invariant #2). `PricedCartLine` doesn't carry it
   * natively — the gate enriches the order before resolving the policy.
   */
  minimumAge?: number;
  /** Product category (e.g. "Beverages"); available to custom `.when()` predicates. */
  category?: string;
  /** Example custom flag a `prescription` `appliesTo` reads. */
  requiresRx?: boolean;
  /** Any catalog attribute a custom `defineCredential` `appliesTo` keys on (a host that
   *  forwards arbitrary product fields onto the line — e.g. the storefront's `priceCart` —
   *  makes them readable here). Typed `unknown`; the predicate narrows it. */
  [attribute: string]: unknown;
}

export interface GateOrder {
  /** Stable per checkout (created once). */
  id: string;
  /** Cents; re-derived server-side. */
  total: number;
  /** ISO 4217. */
  currency: string;
  /** Carries the data conditional predicates read. */
  lines: OrderLine[];
}

// ── Credential (policy — code; NOT serialized) ─────────────────────────────

/**
 * A gate in the policy. Built-ins (`age.over(21)`, `membership.discount(10)`,
 * `payment.in("usd")`) and customs (`defineCredential`) are the same shape; the
 * resolver reads `effect` + `params` + `ui` and runs `when` / `appliesTo`.
 */
export interface Credential {
  /** `"age"` / `"membership"` / `"payment"` / custom. */
  id: string;
  /** What to ask the wallet. */
  request: DcqlQuery;
  /** Reads disclosed claims → proven? (Security: explicit positive claim.) */
  verify: (claims: Record<string, unknown>) => boolean;
  /** `gate()` | `discount({percent})` | `authorize()`. */
  effect: Effect;
  /**
   * Inclusion predicate — the gate is in the manifest only when this returns
   * true (absent ⇒ always applies). `defineCredential` sets the definition-time
   * conditional here (e.g. prescription only for Rx); `.when()` composes a
   * call-site conditional onto it (AND). One field, one check in the resolver.
   */
  appliesTo?: (order: GateOrder) => boolean;
  /** The card shown in Context 2 (the checkout page). */
  ui: { label: string; action: string };
  /** Builder-derived parameters (`age.over(21)` → `{ minAge: 21 }`). */
  params?: { minAge?: number; percent?: number; currency?: string };
  /**
   * Attach a call-site conditional (e.g. `age.over(21).when(hasAlcohol)`).
   * Returns a NEW Credential (chainable, non-mutating); the predicate is AND-ed
   * onto any existing `appliesTo`.
   */
  when(predicate: (order: GateOrder) => boolean): Credential;
}

// ── Step (policy entry) ────────────────────────────────────────────────────

export interface Step {
  /** The gate. */
  credential: Credential;
  /** `required(c)` → true; `optional(c)` → false. */
  required: boolean;
}

// ── Manifest (output — data, serialized to the agent + widget) ─────────────

/** The flat, JSON-safe element of `requires`. No functions. */
export interface VerificationManifestEntry {
  credential: string;
  required: boolean;
  effect: "gate" | "discount" | "authorize";
  /** Where it runs (Principle VII — honesty in the type). */
  enforcedAt: "tool" | "checkout";
  /** mdoc trust (Principle VII; matches the envelope's field — no regression). */
  trust_level: TrustLevel;
  /** From `ui.label`; human-readable for agent / widget. */
  label: string;
  /** age only. */
  minAge?: number;
  /** discount only. */
  discountPct?: number;
  /** Per-order link (gate / authorize effects). */
  approveUrl?: string;
}

// ── Store (per order id — never process-global; Security invariant 4) ──────

export interface VerificationRecord {
  ageVerified?: boolean;
  loyalty?: { applied: boolean; membershipNumber: string | null };
  /**
   * Custom gate() credentials proven for THIS order, keyed by credential id
   * (007 / invariant 4). This is the SINGLE source for custom-gate proof — the
   * generalized credential rail writes `true` here on an explicit-positive custom
   * verify, and `completeOrder` reads ONLY this map to enforce every applicable
   * custom gate. Built-in age/membership keep their dedicated fields above.
   *
   * (There is deliberately no `[credentialId: string]: unknown` index signature: a
   * per-id value written directly on the record would NOT be seen by the sweep, which
   * reads `verifiedGates` — a silent un-enforcement. One representation wins.)
   */
  verifiedGates?: Record<string, true>;
}

export interface VerificationStore {
  read(orderId: string): VerificationRecord | undefined | Promise<VerificationRecord | undefined>;
  write(orderId: string, record: VerificationRecord): void | Promise<void>;
  clear(orderId: string): void | Promise<void>;
}

export interface CredentAgentOptions {
  /**
   * Absolute origin the wallet ceremony binds to (e.g. `https://shop.example`).
   * Optional — defaults to `http://localhost:<PORT|3000>` so zero-config local
   * dev works. Warns (never throws) if it's not absolute, or if it resolves to
   * localhost in production. Set it to your public origin for any deployment.
   */
  walletOrigin?: string;
  /** Per-order verification state; default in-memory, pluggable (Redis). */
  store?: VerificationStore;
  /**
   * Custom credentials to register at construction, so EVERY instance can enforce them
   * from boot — independent of whether `requirements()` ran on this instance (007 / item 5).
   *
   * `requirements()` also registers each policy credential lazily (register-on-resolve), which
   * is enough for a single long-lived process. But in a serverless / multi-worker deploy the
   * instance that COMPLETES an order is often not the one that ran checkout, so its registry is
   * empty and the completion sweep would no-op — an applicable `gate()` checking out UNPROVEN
   * (fail-open). Declare your custom credentials here and every instance enforces them.
   */
  credentials?: Credential[];
}
