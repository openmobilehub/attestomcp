# Data Model: Generic credential rail

Phase 1 output. The entities and state this feature adds or extends. Types below are illustrative shapes
(TypeScript-flavored) to anchor the design; exact declarations land in implementation.

## Entities

### Credential *(existing — unchanged shape)*

The thing to prove, defined by object. Built-ins (`age`/`membership`/`payment`) and custom credentials share
this shape (`packages/credentagent-gate/src/types.ts`).

```
interface Credential {
  id: string;                                   // registry key; reserved: age | membership | payment
  request: DcqlQuery;                           // the wallet request (mso_mdoc)
  verify: (claims: Record<string, unknown>) => boolean;  // explicit positive claim (invariant 5)
  effect: Effect;                               // gate() | discount() | authorize()
  appliesTo?: (order: GateOrder) => boolean;    // definition-time conditional (AND-ed with .when())
  ui: { label: string; action: string };
  params?: { minAge?: number; percent?: number; currency?: string };  // built-in order-derived params
}
```

**Change:** none to the shape. The change is that a custom credential's `request` and `verify` are now
**executed by the mounted rail**, not merely resolved into the manifest.

### CredentialRegistry *(new — internal, in-process)*

An id→credential lookup on the `CredentAgent` instance. Not persisted, not serialized, never on the wire.

```
type CredentialRegistry = Map<string, Credential>;
```

- **Populated** synchronously in `requirements()` (register-on-resolve): each policy step's credential is
  `set` by id.
- **Injected** into the ceremony context at `mount()`, reaching the rail (build request / run verify by id)
  and `completeOrder` (sweep for applicable `gate()` credentials).
- **Reserved ids** (`age`, `membership`, `payment`) stay on their existing built-in code paths; the registry
  sweep at completion **excludes** them.
- **Invariant:** holds code only. `verify`/`appliesTo`/`request` never leave the process (Principle VI).

### VerificationRecord *(extended)*

Per-order verification state, keyed by order id in the `VerificationStore` (invariant 4). Today it carries
`ageVerified` and `loyalty`; this feature adds a generic per-credential gate map.

```
interface VerificationRecord {
  ageVerified?: boolean;                         // built-in age (unchanged)
  loyalty?: { applied: boolean; membershipNumber: string | null };  // built-in membership (unchanged)
  verifiedGates?: Record<string, true>;          // NEW: custom gate id → verified (explicit positive)
  [credentialId: string]: unknown;               // existing index signature
}
```

- **Written** by the rail's `recordVerified` when a custom credential's own `verify(claims)` returns true.
- **Read** by `completeOrder` to enforce applicable `gate()` credentials.
- **Cleared** on completion alongside `ageVerified`/`loyalty` (existing `verificationStore.clear(orderId)`).

### CompletionResult.reason *(extended enum)*

```
reason?: "gates" | "cart-mandate" | "reprice" | "reconcile" | "age" | "gate";
                                                                          //  ^ NEW
```

`"gate"` = an applicable required custom `gate()` credential was not positively verified for this order.

### Professional-license pack *(new — the worked credential)*

A `defineCredential` credential shipped as example + docs. Presence-only-demo doctype/claim (illustrative):

```
const professionalLicense = defineCredential({
  id: "professional_license",
  request: dcql({ docType: "org.example.license.1", claims: ["license_active"] }),
  verify: (c) => c.license_active === true,           // explicit positive (invariant 5)
  effect: gate(),
  appliesTo: (order) => order.lines.some((l) => l.category === "Licensed"),  // conditional
  ui: { label: "Professional license", action: "Verify your license" },
});
```

- `trust_level: "presence-only-demo"` on every surface.
- Catalog carries a `Licensed`-category line so the gate has something to fire on (mirrors
  `examples/custom-credential.mjs`'s `Pharmacy` pattern; the storefront's `PricedCartLine` forwards
  `category`).

## State transitions (custom gate, per order)

```
unverified ──(POST /credentagent/credential/verify, cred=<id>, explicit positive claim)──▶ verifiedGates[id]=true
   │                                                                                              │
   │ completeOrder: applicable gate() && !verifiedGates[id]  ──▶ refuse (reason "gate")           │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
verifiedGates[id]=true  ──(completeOrder)──▶ completed  ──▶ verificationStore.clear(orderId)
```

## Validation rules (from requirements)

| Rule | Source |
| :-- | :-- |
| A custom gate passes only on an explicit positive claim; token presence is insufficient. | FR-007 / invariant 5 |
| Applicability is computed from the re-priced order at completion, never the token. | FR-005 / invariant 2 |
| `verifiedGates` is scoped per order id; one order's proof never satisfies another. | FR-006 / invariant 4 |
| An applicable required `gate()` credential blocks completion on every path until verified. | FR-004 / invariant 1 |
| Reserved built-in ids (`age`/`membership`/`payment`) keep their existing enforcement; no regression. | FR-008 |
| Every custom surface reports `trust_level: "presence-only-demo"`. | FR-010 / Principle VII |
