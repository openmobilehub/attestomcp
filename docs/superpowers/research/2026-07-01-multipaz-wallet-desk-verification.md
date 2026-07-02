# Desk verification: Multipaz Wallet transaction_data + provisioning (overnight, 2026-07-01)

**Method**: read the `main`-branch source of `openwallet-foundation/multipaz` (SDK) and
`openwallet-foundation/multipaz-wallet` (the published app), shallow-cloned 2026-07-01. **Caveat**: the
published APK at apps.multipaz.org may lag `main`; every finding below still needs one on-device
confirmation session (the §12 spike), but the *code* answers are now known.

**Purpose**: de-risk §12.1/§12.1b of `specs/005-human-not-present/connector-architecture-design.md` before
building anything.

---

## F1 — Unknown transaction_data types: the wallet REJECTS the whole request

`TransactionDataJson.parse` looks each item's `type` up in the `DocumentTypeRepository`; an unregistered
type throws (`multipaz/src/commonMain/kotlin/org/multipaz/presentment/TransactionDataJson.kt:173-174`),
caught and rethrown in `OpenID4VP.kt:430-436`. The SDK documents this as OpenID4VP-compliant behavior
(`TransactionType.kt:18-20`: *"unregistered transaction types cause the whole request to be rejected"*).
The user never sees a consent sheet. **A custom `IntentMandate` type sent blind fails hard.**

## F2 — Consent-sheet rendering is GENERIC: only the type's displayName shows

`multipaz-compose/.../presentment/Consent.kt:615-639` renders transaction data as a red highlighted box
containing only `"• ${data.type.displayName}"` — for `PaymentTransaction`, literally **"• Payment"**. The
amount, currency, and payee in the payload are **not displayed** by the wallet today, even for the fully
registered type. ⇒ **The design doc's §5 claim that the wallet "renders the bounds natively on the
biometric sheet" was WRONG** (corrected in the same commit as this note). The terms display must live on
the approve page we control; the wallet's role today is sealing, not showing.

## F3 — The sealing is real: DeviceKey covers transaction_data hashes

`mdocPresentment.kt:315-351` puts `transaction_data_hash` into DeviceNamespaces;
`MdocDocument.kt:164-176` includes those in the DeviceAuthentication structure the DeviceKey signs. So the
cryptographic half of the intent ceremony works exactly as designed — the bounds are device-signed even
though they are not wallet-rendered.

## F4 — THE JACKPOT: the registered PaymentTransaction type already expresses our bounds

`PaymentTransaction` (`multipaz-doctypes/.../knowntypes/PaymentTransaction.kt`) is
**`urn:eudi:sca:payment:1` — the EUDI wallet SCA spec (TS12)** — and it natively models
**merchant-initiated transactions (MIT) with recurrence limits**:

| Our bounds concept | TS12 field (in the registered type, in the published wallet TODAY) |
| :-- | :-- |
| per-draw cap | `recurrence.mit_options.max_amount` — "maximum amount of a single payment under this transaction" |
| **cumulative cap** | `recurrence.mit_options.total_amount` — "total amount of all payments" |
| variable draw amounts | `recurrence.mit_options.amount_variable` |
| window | `recurrence.start_date` / `recurrence.end_date` |
| draw cadence | `recurrence.frequency` (INDA…YEAR) |
| merchant | `payee { name, id, website, logo }` |
| currency | `currency` (ISO 4217) |
| MIT semantics | `amount_estimated`, `amount_earmarked` |

**Consequence: no custom transaction type is needed — semantically or technically.** The Intent Mandate's
money bounds are a standards-blessed EUDI SCA MIT authorization. The upstream ask shrinks to *rendering*
(F2), which benefits every EUDI SCA user, not just us.

`isApplicable` requires an `MdocCredential` with docType **`org.multipaz.payment.sca.1`** — which IS the
Utopia `DigitalPaymentCredential.CARD_DOCTYPE` (`multipaz-utopia/.../DigitalPaymentCredential.kt:22`).
UPay already runs this exact pairing in production demo. (The type's `sampleData` payee is, delightfully,
"Linux Foundation".)

## F5 — What TS12 does NOT carry: product scope → bind via transaction_id

The TS12 payload has no product/SKU field. Solution (standard pattern, same as AP2's `cart_hash`):
**`transaction_id` = our `intentId`, where `intentId` commits (hash) to the full bounds document** (GTIN
scope, `K_s`, honesty labels, everything). The DeviceKey signature covers `transaction_id` → transitively
covers the full bounds. Money bounds ride visibly(-eventually) in TS12 fields; the rest rides in the
committed bounds doc held by the wallet server.

## F6 — Provisioning is backend-gated: DON'T be the issuer

The published wallet provisions only from issuers its configured backend lists (default
`https://dev.wallet.multipaz.org`, `multipaz-wallet/build.gradle.kts:46`; issuer list via
`walletClient.getCredentialIssuers()`); arbitrary-issuer URL entry is **dev-mode only**, and the backend
must be reachable regardless (it validates device attestation at provisioning).

**Consequence — a scope REDUCTION for us**: our wallet server should **not** run OpenID4VCI issuance.
Reuse the Multipaz-hosted DPC issuance (the user adds their Utopia payment card via the standard flow —
which the demo can show); our wallet server is **verifier + policy engine + draw signer + MCP connector**
only. Presentment (OpenID4VP verify) has no equivalent backend gate — any verifier can request; the
wallet may show an unknown-verifier warning (confirm on device).

## Revised plan deltas

1. Design doc §5 corrected (sealing ✓, rendering ✗ — approve page carries the terms; upstream ask =
   render TS12 payload fields).
2. Wallet-server scope: drop issuance; keep verifier/policy/signer/MCP.
3. Cumulative cap: now **standards-expressible** (`total_amount`) — §15's beat-2 feasibility improves;
   still a policy-engine build item, no longer a modeling invention.
4. On-device spike (still required, now confirmatory): (a) present DPC with TS12 transaction_data incl.
   `recurrence.mit_options` and confirm "• Payment" rendering + successful deviceAuth; (b) confirm the
   hosted issuance flow provisions the DPC; (c) note the unknown-verifier warning UX.
5. Upstream conversation content changes: NOT "add our type" but "render PaymentTransaction fields on the
   consent sheet" (+ demo-issuer logistics if we ever need our own issuance).
