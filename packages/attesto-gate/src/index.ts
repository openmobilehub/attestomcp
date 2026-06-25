// @openmobilehub/attesto-gate — the consent layer for AI agents (v0.1).
//
// An AI agent must prove a verifiable credential from the user's phone wallet
// before a consequential MCP tool completes. Identity leads; payments is one
// application.
//
// v0.1 ships the agent-facing primitive: when a gated tool can't complete, it
// returns a typed `verification_required` envelope an agent can DRIVE (why it
// stopped, which credential, a per-order approve link, the tool to poll) —
// instead of a dead error string. The fail-closed mdoc verifier and the
// OpenID4VP ceremony are provided by the reference server today; see the
// roadmap for the full route-mounting extraction (`mountGate`).

export const ENVELOPE_VERSION = "attesto.verification/v1" as const;
export const ENVELOPE_SENTINEL = "verification_required" as const;

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

/** Typed identity helper — returns the query unchanged. */
export function dcql(query: DcqlQuery): DcqlQuery {
  return query;
}

/**
 * The age DCQL, matching the reference verifier (ISO 18013-5 mDL + EU PID).
 * Mirrors the server's credential-gate/dcql.ts so the envelope describes the
 * request the wallet will actually receive.
 */
export function ageDcql(): DcqlQuery {
  return {
    credentials: [
      {
        id: "mdl",
        format: "mso_mdoc",
        meta: { doctype_value: "org.iso.18013.5.1.mDL" },
        claims: [
          { path: ["org.iso.18013.5.1", "age_over_21"], intent_to_retain: false },
          { path: ["org.iso.18013.5.1", "age_over_18"], intent_to_retain: false },
        ],
      },
      {
        id: "eupid",
        format: "mso_mdoc",
        meta: { doctype_value: "eu.europa.ec.eudi.pid.1" },
        claims: [{ path: ["eu.europa.ec.eudi.pid.1", "age_over_18"], intent_to_retain: false }],
      },
    ],
  };
}

// ── Credential model ───────────────────────────────────────────────────────

/** Built-in credential kinds enforced (age) or recognized (membership/payment) in v0.1. */
export type BuiltinKind = "age" | "membership" | "payment";

export interface Step {
  credential: BuiltinKind;
  required: boolean;
}

/** A required step — blocks the action until the credential is proven. */
export function requireCredential(credential: BuiltinKind): Step {
  return { credential, required: true };
}
/** An optional step — applied only if the shopper presents it. */
export function optionalCredential(credential: BuiltinKind): Step {
  return { credential, required: false };
}

/**
 * How honestly the presented mdoc is trusted. v0.1 enforces *disclosure*
 * (explicit positive claim) and *binding* (nonce/ephemeral-key), but NOT
 * *trust* (issuer/device signatures) — a self-crafted mdoc would pass. Stating
 * this in the envelope is deliberate: it's a flow demo, not a safety control.
 * See the roadmap (mdoc trust verification via Multipaz / @auth0/mdl).
 */
export type TrustLevel = "presence-only-demo" | "issuer-verified";

// ── The verification_required envelope ─────────────────────────────────────

export interface VerificationRequired {
  /** Sentinel an agent/client keys on to detect a consent handshake. */
  _attesto: typeof ENVELOPE_SENTINEL;
  version: typeof ENVELOPE_VERSION;
  order: { id: string; total: number; currency: string };
  reason: { gate: string; pass: false; detail: string };
  present: {
    credential: BuiltinKind;
    /** Age threshold, when the credential is `age`. */
    min_age?: number;
    /** The DCQL the wallet will receive. */
    request: DcqlQuery;
    /** Per-order link the buyer opens to prove the credential on their phone. */
    approve_url: string;
  };
  /** How the agent resumes once the buyer has proven the credential. */
  resume: { tool: string; poll: string };
  trust_level: TrustLevel;
}

export interface BuildEnvelopeArgs {
  order: { id: string; total: number; currency: string };
  credential: BuiltinKind;
  request: DcqlQuery;
  approveUrl: string;
  detail: string;
  minAge?: number;
  gate?: string;
  resumeTool?: string;
  trustLevel?: TrustLevel;
}

/** Build the typed refusal an agent can drive. Pure — no I/O. */
export function buildVerificationRequired(args: BuildEnvelopeArgs): VerificationRequired {
  return {
    _attesto: ENVELOPE_SENTINEL,
    version: ENVELOPE_VERSION,
    order: { id: args.order.id, total: args.order.total, currency: args.order.currency },
    reason: {
      gate: args.gate ?? (args.minAge != null ? `Age over ${args.minAge}` : "Verification"),
      pass: false,
      detail: args.detail,
    },
    present: {
      credential: args.credential,
      ...(args.minAge != null ? { min_age: args.minAge } : {}),
      request: args.request,
      approve_url: args.approveUrl,
    },
    resume: { tool: args.resumeTool ?? "get-order-status", poll: "until status=completed or refused" },
    trust_level: args.trustLevel ?? "presence-only-demo",
  };
}

/** True if a tool result is a verification_required envelope (for agents/clients). */
export function isVerificationRequired(
  v: unknown,
): v is VerificationRequired {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { _attesto?: unknown })._attesto === ENVELOPE_SENTINEL
  );
}

/** A one-line, agent-facing instruction string to carry alongside the envelope. */
export function envelopeInstruction(env: VerificationRequired): string {
  const what =
    env.present.credential === "age"
      ? `age verification (${env.present.min_age ?? 21}+)`
      : `a ${env.present.credential} credential`;
  return (
    `This order needs ${what} before it can be placed. Share this link with the buyer to ` +
    `prove it on their phone: ${env.present.approve_url} — then poll \`${env.resume.tool}\` ` +
    `until it completes. Do not tell the user the order is placed until then.`
  );
}

// ── gated(): wrap a tool handler so it can't complete unproven ──────────────

export interface MinimalToolResult {
  structuredContent?: Record<string, unknown>;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface GateOrder {
  id: string;
  total: number;
  currency: string;
  lines: { id: string }[];
}

export interface EasyGatePolicy {
  /** Require age verification. `true` defaults the threshold to the cart's strictest item. */
  age?: boolean;
  membership?: { discount: number };
  payment?: { amount: number };
}

export interface GateDeps<A, O extends GateOrder> {
  /** Resolve the order from the tool args (created ONCE, so the id is stable). */
  resolveOrder: (args: A) => O | Promise<O>;
  /** True iff this order is age-restricted AND has no recorded age verification. */
  isAgeUnverified: (order: O) => boolean | Promise<boolean>;
  /** Per-order link the buyer opens to prove age. */
  approveUrl: (order: O) => string;
  /** The age threshold for this order (e.g. 21), or undefined. */
  minAge?: (order: O) => number | undefined;
  /** The DCQL to request; defaults to `ageDcql()`. */
  request?: DcqlQuery;
  resumeTool?: string;
}

/**
 * Wrap an MCP tool handler so it returns a `verification_required` envelope when
 * a required credential isn't met, instead of completing. v0.1 enforces the
 * **age** gate at the tool layer (closing the gap where an MCP `checkout` tool
 * could mint a completable link with no proof); membership/payment are declared
 * in the policy and enforced on the device-authorization paths (see roadmap).
 *
 * The handler receives the resolved order so it never re-creates it (a fresh id
 * each call would desync the approve link from the verified order).
 */
export function gated<A, O extends GateOrder>(
  handler: (args: A, ctx: { order: O }) => MinimalToolResult | Promise<MinimalToolResult>,
  policy: EasyGatePolicy,
  deps: GateDeps<A, O>,
): (args: A) => Promise<MinimalToolResult> {
  return async (args: A): Promise<MinimalToolResult> => {
    const order = await deps.resolveOrder(args);
    if (policy.age && (await deps.isAgeUnverified(order))) {
      const minAge = deps.minAge?.(order);
      const env = buildVerificationRequired({
        order,
        credential: "age",
        request: deps.request ?? ageDcql(),
        approveUrl: deps.approveUrl(order),
        detail: `Cart contains age-restricted items. No age verification on file for order ${order.id}.`,
        minAge,
        resumeTool: deps.resumeTool,
      });
      return {
        structuredContent: env as unknown as Record<string, unknown>,
        content: [{ type: "text", text: envelopeInstruction(env) }],
      };
    }
    return handler(args, { order });
  };
}
