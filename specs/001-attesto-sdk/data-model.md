# Phase 1 — Data Model: Attesto SDK v0.1

Entities the implementation models. Two layers: **policy** (code — functions, lives in your server) and
**manifest** (data — serialized to the wire). `requirements()` is the boundary.

## Attesto (client)

The configure-once client.

| Field | Type | Notes |
|-------|------|-------|
| `walletOrigin` | `string` | Origin the wallet ceremony binds to; per-order approve link = `walletOrigin + /credential-gate/age?order=<id>`. |
| `store` | `VerificationStore` | Per-order verification state; default in-memory, pluggable (Redis). |

**Methods**
- `mount(app): void` — mounts `/credential-gate/*` ceremony routes on the Express app; wires `store`.
- `requirements(order, policy): VerificationManifestEntry[]` — resolves policy → serializable manifest.

**Validation**: `walletOrigin` MUST be an absolute origin (refuse `localhost` in production builds).

## GateOrder (input to `requirements`)

The server-priced order (Principle: re-derived, never the raw token).

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Stable per checkout (created once). |
| `total` | `number` | Cents; re-derived server-side. |
| `currency` | `string` | ISO 4217. |
| `lines` | `OrderLine[]` | Carries the data conditional predicates read. |

### OrderLine

| Field | Type | Notes |
|-------|------|-------|
| `id` / `sku` | `string` | Product id. |
| `qty` | `number` | Quantity. |
| `unitPrice` | `number` | Cents; authoritative (catalog). |
| `category` | `string?` | e.g. `"alcohol"` — read by a `.when()` predicate. |
| `minimumAge` | `number?` | Optional per-product threshold (demo's `requiredAgeForLines`). |
| `requiresRx` | `boolean?` | Example custom flag for a `prescription` `appliesTo`. |

## Credential (policy — code)

Built-in or custom. **Not serialized.**

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | `"age"` / `"membership"` / `"payment"` / custom. |
| `request` | `DcqlQuery` | What to ask the wallet. |
| `verify` | `(claims) => boolean` | Reads disclosed claims → proven? (Security: explicit positive claim.) |
| `effect` | `Effect` | `gate()` \| `discount({percent})` \| `authorize()`. |
| `appliesTo?` | `(order) => boolean` | Definition-time conditional (e.g. prescription only for Rx). |
| `when?` | `(order) => boolean` | Call-site conditional, attached via `.when()`. |
| `ui` | `{ label, action }` | The card shown in Context 2. |
| `params?` | `{ minAge?, percent?, currency? }` | From the builder (`age.over(21)` → `minAge:21`). |

**Builders** (return `Credential`): `age.over(n)`, `membership.discount(pct)`, `payment.in(cur)`,
`defineCredential({...})`. All expose `.when(predicate)`.

## Step (policy entry)

| Field | Type | Notes |
|-------|------|-------|
| `credential` | `Credential` | The gate. |
| `required` | `boolean` | `required(c)` → true; `optional(c)` → false. |

A **policy** is `Step[]` — order = run order; payment-bearing step MUST resolve last.

## Effect (tagged data)

`{ kind: "gate" } | { kind: "discount"; percent?: number; amount?: number } | { kind: "authorize" }`.
Interpreted by the resolver; never a handler in v0.1.

## VerificationManifestEntry (output — data, serialized)

The flat, JSON-safe element of `requires`. **No functions.**

| Field | Type | Notes |
|-------|------|-------|
| `credential` | `string` | id. |
| `required` | `boolean` | required vs optional. |
| `effect` | `"gate" \| "discount" \| "authorize"` | the kind only. |
| `label` | `string` | from `ui.label`, human-readable for agent/widget. |
| `minAge?` | `number` | age only. |
| `discountPct?` | `number` | discount only. |
| `approveUrl?` | `string` | per-order link (gate/authorize effects). |

**Invariant**: `JSON.stringify(manifest)` round-trips losslessly (contract test).

## VerificationRecord (store — per order id)

| Field | Type | Notes |
|-------|------|-------|
| key | `order.id` | Never process-global (Security invariant 4). |
| `ageVerified` | `boolean` | set by `/credential-gate/age/verify`. |
| `loyalty` | `{ applied: boolean; membershipNumber: string \| null }` | discount state. |
| *(custom)* | per credential id | set by the generic ceremony on verify. |

## DcqlQuery

`{ credentials: Array<{ id, format: "mso_mdoc", meta: { doctype_value }, claims: Array<{ path, intent_to_retain? }> }> }` — mirrors the reference verifier's DCQL.

## Relationships

```
Attesto ──mount──▶ /credential-gate/* + VerificationStore (per order.id)
Attesto ──requirements(order, policy)──▶ resolve each Step.credential against GateOrder
   Step.credential.(when|appliesTo)(order) decides inclusion
   Step.credential.effect + params + ui  ──serialize──▶ VerificationManifestEntry[]   (← the wire boundary)
```
