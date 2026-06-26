// @openmobilehub/attesto-gate — the consent layer for AI agents (v0.1).
//
// Require a verifiable credential from the user's phone wallet before a
// consequential MCP tool completes. Identity leads; payments is one application.
//
// The v0.1 surface (consolidated Mode A):
//   • new Attesto({ walletOrigin })            — configure once
//   • attesto.requirements(order, policy)      — Context 1: policy → serializable manifest
//   • attesto.mount(app)                       — Context 2: ceremony seam
//   • required/optional over age/membership/payment builders, .when() conditional
//   • defineCredential + gate/discount/authorize + dcql — gate ANY credential
// The `verification_required` envelope + gated() are retained as the Mode-B /
// roadmap blocking primitive (page-less tools); see ROADMAP.

// ── Client ───────────────────────────────────────────────────────────────
export { Attesto } from "./client.js";
export type { ExpressApp } from "./client.js";

// ── Policy builders + extensibility ────────────────────────────────────────
export { age, membership, payment, required, optional, defineCredential, dcql, gate, discount, authorize } from "./credentials.js";

// ── Store ────────────────────────────────────────────────────────────────
export { MemoryVerificationStore } from "./store.js";

// ── Public types ───────────────────────────────────────────────────────────
export type {
  AttestoOptions,
  GateOrder,
  OrderLine,
  Credential,
  Step,
  Effect,
  VerificationManifestEntry,
  VerificationStore,
  VerificationRecord,
  TrustLevel,
  DcqlQuery,
  DcqlClaim,
  DcqlCredentialOption,
} from "./types.js";

// ── Retained: Mode-B / roadmap blocking primitive (do NOT break the wire shape) ──
export {
  ageDcql,
  buildVerificationRequired,
  isVerificationRequired,
  envelopeInstruction,
  ENVELOPE_VERSION,
  ENVELOPE_SENTINEL,
} from "./envelope.js";
export type { VerificationRequired, BuildEnvelopeArgs, BuiltinKind } from "./envelope.js";

// gated() — deprecated Mode-B shim (use requirements() for checkout).
export { gated } from "./gated.js";
export type { EasyGatePolicy, GateDeps, MinimalToolResult } from "./gated.js";
