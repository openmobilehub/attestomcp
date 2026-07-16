// The shared completion seam (every rail records through this one path):
//   gates → catalog re-derivation → idempotency → settlement (when configured) →
//   completed record + cart clear + per-order verification clear.
// Extracted from the demo's payment-gate/completion.ts, but injected-seam based
// (no hardcoded demo imports) so dc-payment and passkey reconcile against the same
// amount-binding logic. Settlement GATES completion: a configured-but-failed
// settle means authorized-but-not-completed (no record, cart intact — FR-013).
import type { Credential, GateOrder, VerificationStore } from "../types.js";
import type { CartItemRef, CeremonyCatalog, CompletionInput, CompletionResult, GateOutcome } from "./types.js";
import { verifyCartMandate, type CartMandate } from "./cartMandate.js";
import { reconcileCartPayment } from "./reconciliation.js";
import { RESERVED_CREDENTIAL_IDS } from "../credentials.js";

// One on-chain (demo-mode) settlement backing a completed order. Kept structural
// so the demo's richer SettlementRecord is assignable without the package taking
// a settlement dependency.
export interface SettlementRecordLike {
  network: string;
  txId: string;
  status: string;
  [k: string]: unknown;
}

// A completed-purchase record. On a successful ceremony the gate writes one of
// these so the agent can later poll it (MCP has no server→client push) and
// confirm the purchase. Keyed by order id — never process-global (invariant 4).
export interface CompletedRecord {
  orderId: string;
  mandateId: string;
  amount: number;
  currency: string;
  method: string;
  instrument?: unknown;
  gates: GateOutcome[];
  completedAt: string;
  settlement?: SettlementRecordLike;
}

export interface CompletedOrderStore {
  read(orderId: string): CompletedRecord | undefined | Promise<CompletedRecord | undefined>;
  write(record: CompletedRecord): void | Promise<void>;
}

export interface ClearableCart {
  clear(): void | Promise<void>;
}

export interface CompletionContext {
  catalog: CeremonyCatalog;
  verificationStore: VerificationStore;
  /** Idempotent completed-order store, keyed by order id. */
  records: CompletedOrderStore;
  /** Cart to empty on completion (optional). */
  cart?: ClearableCart;
  /** Optional demo-mode settlement; throwing GATES completion (no record). */
  settle?: (order: CompletionInput["order"]) => Promise<SettlementRecordLike>;
  /** Optional HMAC key for Cart Mandate verification. When set AND the input carries a
   *  `cartMandate`, completion verifies it (signature + order-id binding + expiry)
   *  before re-pricing. Absent ⇒ the cart-mandate check is skipped (additive). */
  signingKey?: string;
  /**
   * The gate's in-process credential registry (id → Credential), populated by
   * `requirements()` and injected by `mount()` (007). When present, completion
   * enforces EVERY applicable custom `gate()` credential — re-deriving applicability
   * from the RE-PRICED order (invariant 2) and refusing any not in the order's
   * `verifiedGates` (invariant 1). Reserved built-ins are excluded (they keep their
   * own enforcement). Absent ⇒ the custom-gate sweep is skipped (additive).
   */
  credentialRegistry?: ReadonlyMap<string, Credential>;
}

export async function completeOrder(input: CompletionInput, ctx: CompletionContext): Promise<CompletionResult> {
  // Every deterministic gate must have passed; one failure refuses, recording
  // nothing.
  if (!input.gates.every((g) => g.pass)) return { completed: false, reason: "gates" };

  // Idempotency: a replayed verify for an already-recorded order echoes the
  // recorded outcome — it settles/records nothing twice. Keyed by order id so it
  // can't collide across orders, and it runs BEFORE re-pricing because completion
  // clears the order's verification (a replayed discounted order would otherwise
  // reprice high and refuse).
  const existing = await ctx.records.read(input.order.id);
  if (existing) {
    return { completed: true, ...(existing.settlement ? { settlement: existing.settlement } : {}) };
  }

  // Cart Mandate integrity (additive, fail-closed): if a signed cart mandate rode along
  // AND we hold the key, verify it BEFORE re-pricing — a tampered, replayed (wrong-order)
  // or expired cart is refused here with an explicit reason. The catalog STILL re-derives
  // the price below; the signature proves the server issued the cart, not the price
  // (invariant 2). A valid-signature-but-wrong-price mandate therefore still fails the
  // re-price check — the mandate is defense-in-depth, never a substitute for it. The
  // verified mandate is reconciled against the Payment Mandate's binding AFTER re-pricing.
  let cartMandate: CartMandate | undefined;
  if (input.cartMandate && ctx.signingKey) {
    const verdict = verifyCartMandate(input.cartMandate, input.order.id, ctx.signingKey);
    if (!verdict.ok) return { completed: false, reason: "cart-mandate" };
    cartMandate = verdict.mandate;
  }

  // Invariant 2: never trust the order token — re-price the lines against the
  // catalog and refuse if the inbound total doesn't match what those items cost.
  // Invariant 3: a loyalty discount only counts when THIS order's verification
  // says it was applied; a token merely claiming the discounted total reprices
  // higher and is refused.
  const verification = await ctx.verificationStore.read(input.order.id);
  const loyaltyApplied = !!(verification as { loyalty?: { applied?: boolean } } | undefined)?.loyalty?.applied;
  const items: CartItemRef[] = input.order.lines.map((l) => ({ productId: l.id, quantity: l.quantity }));
  const repriced = ctx.catalog.createOrder(items, input.order.id, { loyaltyApplied });
  if (repriced.total !== input.order.total) return { completed: false, reason: "reprice" };

  // Invariant 3: when a signed Cart Mandate AND a signed Payment Mandate are both
  // present, the two envelopes must tell ONE story before completing — same order,
  // consistent currency, and the cart's sealed total == the catalog-RE-DERIVED total
  // == the Payment Mandate's bound amount (`input.amount`, projected from
  // `mandate.payment` by every rail). This binds the cart's seal to the payment's
  // signature across ALL paths: a cart sealed for X paired with a payment for Y≠X, a
  // currency or order mismatch, or a discount one path blesses and another refuses is
  // refused here, never silently under-charged. Re-priced (not the token) per invariant 2.
  if (cartMandate) {
    const agree = reconcileCartPayment(
      cartMandate,
      { amount: input.amount, currency: input.currency, orderId: input.order.id },
      repriced.total,
    );
    if (!agree.ok) return { completed: false, reason: "reconcile" };
  }

  // Invariant 1: enforce the age gate on EVERY completion path. The age restriction
  // is re-derived from the catalog-priced lines (never the token); an age-restricted
  // order must carry a positive per-order age claim — written by the credential
  // gate's verify handler (credential-gate/routes.ts) — before it can complete. This
  // is the shared-completion-seam half of CT9; the demo's place-order + MCP
  // order-completion-tool halves are wired in T014.
  const ageRestricted = repriced.lines.some((l) => typeof l.minimumAge === "number" && l.minimumAge > 0);
  if (ageRestricted && (verification as { ageVerified?: boolean } | undefined)?.ageVerified !== true) {
    return { completed: false, reason: "age" };
  }

  // Invariant 1 (generalized — 007): enforce EVERY applicable custom `gate()`
  // credential, not only age. `gate()` is the hard-block effect, so it is enforced
  // whenever it applies, independent of the required/optional flag. Applicability is
  // re-derived from the RE-PRICED order (invariant 2), never the token; the registry
  // holds the credential CODE (verify/appliesTo) in-process, so nothing crossed the
  // wire. Reserved built-ins (age/membership/payment) are excluded — they keep their
  // dedicated enforcement above. Absent registry ⇒ this sweep no-ops (additive), so a
  // host that doesn't wire it (or has no custom gates) is unchanged.
  if (ctx.credentialRegistry) {
    // Evaluate `appliesTo` against the FULL re-priced line — spread every field, never a
    // hand-picked allow-list. The manifest resolver (manifest.ts) runs the SAME predicate
    // against the host's full order; if the completion-time projection dropped a field a
    // custom `appliesTo` reads (e.g. `requiresRx`), the gate would surface as applicable at
    // manifest time yet be skipped here — a fail-OPEN bypass (invariant 1). The re-priced
    // order is the catalog source of truth (invariant 2), so forwarding all of its fields
    // is safe and keeps the two evaluations identical.
    const gateOrder: GateOrder = {
      id: repriced.id,
      total: repriced.total,
      currency: repriced.currency,
      lines: repriced.lines.map((l) => ({ ...l })),
    };
    const verifiedGates = (verification as { verifiedGates?: Record<string, true> } | undefined)?.verifiedGates ?? {};
    for (const cred of ctx.credentialRegistry.values()) {
      if (RESERVED_CREDENTIAL_IDS.has(cred.id)) continue;
      if (cred.effect.kind !== "gate") continue;
      const applies = cred.appliesTo ? cred.appliesTo(gateOrder) : true;
      if (applies && verifiedGates[cred.id] !== true) {
        return { completed: false, reason: "gate" };
      }
    }
  }

  let settlement: SettlementRecordLike | undefined;
  if (ctx.settle) {
    try {
      settlement = await ctx.settle(input.order);
    } catch (err) {
      return { completed: false, settlementError: (err as Error).message };
    }
  }

  await ctx.records.write({
    orderId: input.order.id,
    mandateId: input.mandateId,
    amount: input.amount,
    currency: input.currency,
    method: input.method,
    instrument: input.instrument,
    gates: input.gates,
    completedAt: new Date().toISOString(),
    ...(settlement ? { settlement } : {}),
  });
  if (ctx.cart) await ctx.cart.clear();
  // Completed purchase: clear this order's age/loyalty verification.
  await ctx.verificationStore.clear(input.order.id);
  return { completed: true, ...(settlement ? { settlement } : {}) };
}
