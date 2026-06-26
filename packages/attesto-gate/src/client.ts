// The configure-once client (Principle I): construct with your wallet origin,
// then declarative calls. `requirements(order, policy)` resolves a policy to the
// serializable manifest (Context 1); `mount(app)` is the Context-2 seam.

import type { AttestoOptions, GateOrder, Step, VerificationManifestEntry, VerificationStore } from "./types.js";
import { resolveRequirements } from "./manifest.js";
import { MemoryVerificationStore } from "./store.js";

/**
 * Minimal structural type for an Express app — the package stays dependency-free
 * (no `express` import). `mount()` only needs `app.locals` for the store seam.
 */
export interface ExpressApp {
  locals: Record<string, unknown>;
}

export class Attesto {
  readonly walletOrigin: string;
  readonly store: VerificationStore;

  constructor(opts: AttestoOptions) {
    const origin = opts.walletOrigin?.trim();
    if (!origin || !/^https?:\/\//.test(origin)) {
      throw new Error(`Attesto: walletOrigin must be an absolute http(s) origin, got: ${opts.walletOrigin}`);
    }
    // Refuse localhost in production — the wallet ceremony must bind to a real
    // origin (Security: OpenID4VP/WebAuthn are origin-bound).
    if (process.env.NODE_ENV === "production" && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin)) {
      throw new Error(`Attesto: refusing localhost walletOrigin in production: ${origin}`);
    }
    this.walletOrigin = origin.replace(/\/$/, "");
    this.store = opts.store ?? new MemoryVerificationStore();
  }

  /**
   * Context 1 — resolve a policy against a server-priced order into the flat,
   * JSON-safe `requires` manifest. Runs `.when()`/`appliesTo` predicates,
   * payment-last; no functions cross the wire.
   */
  requirements(order: GateOrder, policy: Step[]): VerificationManifestEntry[] {
    return resolveRequirements(order, policy, { walletOrigin: this.walletOrigin });
  }

  /**
   * Context 2 — wire the verification ceremony onto your Express app. v0.1
   * exposes the per-order store via `app.locals.attesto` so your credential-gate
   * routes resolve verification state THROUGH Attesto (keyed by order id, never
   * process-global — Security invariant 4). The reference server's existing
   * fail-closed `/credential-gate/*` routes (OpenID4VP + mdoc disclosure/nonce
   * checks in `verify.ts`) remain the verifier — this seam does NOT reimplement
   * the crypto. Full route-ownership extraction is tracked on the roadmap.
   */
  mount(app: ExpressApp): void {
    const existing = app.locals.attesto as { store?: VerificationStore } | undefined;
    if (existing?.store === this.store) return; // idempotent
    app.locals.attesto = { store: this.store, walletOrigin: this.walletOrigin };
  }
}
