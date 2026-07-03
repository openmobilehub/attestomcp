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

## Readout table — RUN 2026-07-02 (Pixel 10 Pro, Android 16, adb-driven)

| # | Question | Result |
| :-- | :-- | :-- |
| 1 | Utopia payment card provisionable from the published APK's issuer list? | **NO — hosted issuance broken.** The card IS in the issuer list, but issuance fails with a server-side **500: `NoSuchElementException: List is empty`** (logcat `ProvisioningModel`). Reproduced on wallet **W22 AND W27** (updated mid-spike), for **payment AND core/age** record types. Also: only **1 of 8** hosted personas (Phileas Foggbottom) has a payment record at all; the local repo seed's payment personas (Pivo Miller, Nadezhda Akulova) don't exist on the hosted records server. |
| 2 | Consent sheet rendering | **BLOCKED** by #1 — no credential ever landed |
| 3 | Unknown-verifier warning | BLOCKED |
| 4 | Ceremony end-to-end | BLOCKED |
| 5 | Cross-device QR | BLOCKED |
| 6 | Brewery age+payment | BLOCKED |

### Verdict + next actions (2026-07-02)

The published wallet + hosted-issuer path is **unusable today** — a hosted-infra bug, not a design
problem. Consequences:

1. **Upstream bug report** (concrete, reproducible): wallet W27 + `issuer.multipaz.org` → 500
   "List is empty" on every issuance. This becomes the NEW lead item of the Multipaz conversation
   (stronger than the old Ask 2 — it blocks their own demo, not just ours).
2. **Demo plan flips to self-hosted Utopia stack** (podman; `multipaz-utopia/deployment/README.md`) —
   where `records.json` is ours, the seed has working payment personas, and we control uptime.
   The "zero self-hosted infra" claim of this runbook is dead until the hosted bug is fixed.
3. Ceremony/consent-sheet questions (#2–6) move to the self-hosted rerun.

## What the answers decide

- **1 = yes, 4 = yes** → the §10 recommendation firms up: re-scope toward wallet-custody is buildable on
  hosted infra; our wallet server is the only new backend.
- **2 = displayName-only (expected)** → §5's approve-page-carries-the-terms stands; upstream Ask 1
  (render TS12 payload fields) goes to the Multipaz team **before** the demo.
- **1 = no** → issuance logistics move to the front of the Multipaz conversation (Ask 2).
- Any hard failure in 4 → escalate: that contradicts the desk verification and the hosted UPay demo's
  own purpose; re-check assumptions before building anything.
