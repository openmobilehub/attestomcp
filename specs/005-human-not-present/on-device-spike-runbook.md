# On-device spike runbook — 15 minutes, zero self-hosted infra

**Answers**: §12.1/§12.1b of [connector-architecture-design.md](./connector-architecture-design.md)
(confirmatory after the desk verification) and **feeds the §10 fork decision**.

**Discovery that makes this cheap (2026-07-02)**: the hosted UPay page
(`https://utopia.multipaz.org/upay/`) already drives the exact ceremony under test — its backend is the
`TransactionProcessor` we desk-read, which builds the OpenID4VP request **with the TS12
`PaymentTransaction` transaction_data** (transaction_id, payee, currency, amount). So the published
wallet + the hosted pages answer everything; nothing needs to be stood up.

## Kit

Android phone (GREEN/production build for the standard APK; Dev flavor exists for unlocked bootloaders) ·
Chrome on the phone · ~15 minutes.

## Steps

1. **Install the wallet** — `https://apps.multipaz.org/` → Multipaz Wallet APK (production flavor) →
   sideload. First-run setup as prompted.
2. **Provision credentials** (§12.1b question) — in the wallet: *Add to wallet* → the issuer list comes
   from the wallet backend (`dev.wallet.multipaz.org`). **Record**: does the list include the Utopia
   issuers (Bank of Utopia payment card / DPC; DMV mDL)? Provision the **payment card** (and the mDL if
   offered — useful for the brewery beat later).
   - *If no Utopia payment card appears in the list*: that's a finding, not a failure — record it; it
     means the demo needs the issuance question answered (upstream ask 2 in
     `multipaz-upstream-proposal-draft.md`).
3. **Run the payment ceremony** (§12.1 question) — on the phone's Chrome:
   `https://utopia.multipaz.org/upay/` → pick a payee account from the dropdown → amount e.g. `12.50` →
   keep **openid4vp** checked → Run.
4. **Observe the consent sheet — the money observation.** Screenshot it. Record exactly:
   - [ ] Does it show the **amount/payee** anywhere, or only a generic **"• Payment"** line?
     (Desk prediction F2: displayName only. If it shows MORE, our §5 approve-page mitigation can shrink
     and the upstream ask changes tone.)
   - [ ] Any **unknown-verifier warning** UX? (The wallet may flag an unrecognized relying party.)
   - [ ] Biometric prompt fires ✓
5. **Complete and record the result page** (transaction confirmation from the Bank of Utopia ledger).
6. **Optional (5 more min): the brewery beat** — `https://utopia.multipaz.org/brewery/` → attempt a
   purchase → observe the **combined age + payment** presentment. This is the live preview of
   "delegate actions, not identity."
7. **Cross-device variant (optional)**: run step 3 from a DESKTOP browser instead — expect the QR /
   cross-device handoff. Record whether it works with the published wallet (this is the shape the
   claude.ai approve page will use).

## Readout table — RUN 1, 2026-07-02 morning (published Wallet, Pixel 10 Pro, Android 16, adb-driven)

| # | Question | Result |
| :-- | :-- | :-- |
| 1 | Utopia payment card provisionable from the published APK's issuer list? | **NO — hosted issuance broken.** The card IS in the issuer list, but issuance fails with a server-side **500: `NoSuchElementException: List is empty`** (logcat `ProvisioningModel`). Reproduced on wallet **W22 AND W27** (updated mid-spike), for **payment AND core/age** record types. Also: only **1 of 8** hosted personas (Phileas Foggbottom) has a payment record at all; the local repo seed's payment personas (Pivo Miller, Nadezhda Akulova) don't exist on the hosted records server. |
| 2 | Consent sheet rendering | BLOCKED by #1 (answered in Run 2 below) |
| 3 | Unknown-verifier warning | BLOCKED (Run 2: not directly observable — secure surface) |
| 4 | Ceremony end-to-end | BLOCKED (answered in Run 2 below) |
| 5 | Cross-device QR | BLOCKED (still open after Run 2) |
| 6 | Brewery age+payment | BLOCKED (still open after Run 2) |

## Readout — RUN 2, 2026-07-02 evening (Multipaz **TestApp** route around the broken issuer)

Pivot: the **Multipaz TestApp** (blue variant, `org.multipaz.testapp`, v0.100.0-pre / build 1199)
**self-issues its sample documents on-device** — no hosted issuer in the loop. "Create Test Documents
in Platform Secure Area" → **13 documents in ~11s**, hardware-backed, including **"Erika's Payment
Card Credential"** (`DigitalPaymentCredential`) and an mDL. Ceremony driven on the hosted UPay page
via Chrome DevTools protocol (`run()` with user gesture), payee = seed account `38445565`
(hosted ledger accepts 38445565 / 79356114 / 87874773; rejects unknown accounts).

| # | Question | Result |
| :-- | :-- | :-- |
| 1b | Payment credential obtainable at all? | **YES — TestApp self-issuance.** Hosted-issuer bug stands (report still worth filing) but no longer blocks the ceremony questions. |
| 2 | Consent sheet rendering | **CONFIRMED: displayName-only.** Live run + source: `multipaz-compose … presentment/Consent.kt` renders transaction data as a red (`colorScheme.error`) banner containing only `• ${type.displayName}` → **"• Payment"** — no amount, no payee, no TS12 fields. Same composable serves TestApp AND Wallet. Desk prediction F2 confirmed; §5 approve-page-carries-the-terms stands; upstream Ask 1 unchanged. |
| 3 | Unknown-verifier warning | **Not capturable**: the entire consent UI runs on a **FLAG_SECURE surface** — `adb screencap` returns black frames for the whole ceremony (itself a correct-behavior finding: consent UI is screenshot-proof). Needs eyes-on-device. |
| 4 | Ceremony end-to-end | **Wire: YES. Settlement: REFUSED at issuer trust.** DC API (OpenID4VP v1) → TestApp presents → post-share screen "The info was shared" → UPay backend decrypts + parses the mdoc, then rejects: **`invalid_request: Payment card is not from a trusted issuer`**. The hosted UPay verifier enforces a real issuer trust list — issuer-verified verification exists in the wild on the verifier side, exactly where the design puts it. TestApp's self-signed IACA is (rightly) not in it. |
| 5 | Cross-device QR | Open — rerun from desktop browser. |
| 6 | Brewery age+payment | Open — TestApp's self-issued mDL will presumably hit the same trusted-issuer refusal at the brewery verifier; consent-sheet observation still valuable. |

Bugs found in the hosted stack along the way (upstream-reportable):
- `issuer.multipaz.org`: 500 `NoSuchElementException: List is empty` on ALL issuance (Run 1, the blocker).
- `upay/verify_credentials.js` crashes (`TypeError … reading 'digital'`) instead of surfacing backend
  400s (e.g. unknown payee) — `make_request` errors are never shown to the user.

### Verdict + next actions (2026-07-02, post Run 2)

1. **The §12.1/12.1b questions are answered without self-hosting**: ceremony mechanics work
   end-to-end; consent sheet is displayName-only (mitigation stands); verifier-side issuer trust is
   real in the hosted stack.
2. **Green-path settlement** (a presentation the verifier accepts) still needs either fixed hosted
   issuance or the **self-hosted Utopia stack** with the TestApp/our IACA added to the verifier trust
   list — now needed only for the demo's happy path, not for de-risking.
3. **Upstream bug report stays the lead item** of the Multipaz conversation, now with two bugs and
   one confirmed rendering gap (Ask 1).
4. Open observations for a human-eyes run (secure surface): consent-sheet look, biometric prompt,
   unknown-verifier warning; plus #5 cross-device QR and #6 brewery beat.

## What the answers decide

- **1 = yes, 4 = yes** → the §10 recommendation firms up: re-scope toward wallet-custody is buildable on
  hosted infra; our wallet server is the only new backend.
- **2 = displayName-only (expected)** → §5's approve-page-carries-the-terms stands; upstream Ask 1
  (render TS12 payload fields) goes to the Multipaz team **before** the demo.
- **1 = no** → issuance logistics move to the front of the Multipaz conversation (Ask 2).
- Any hard failure in 4 → escalate: that contradicts the desk verification and the hosted UPay demo's
  own purpose; re-check assumptions before building anything.
