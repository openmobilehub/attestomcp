# DRAFT — talk outline: "Human Not Present: One Tap, Bounded Trust"

**Status**: draft (overnight 2026-07-01), for maintainer rework. Title per the 2026-07-01 shortlist;
"Delegate Actions, Not Identity" reserved as the honesty section header. All demo beats assume the
connector architecture (tentative) and the §12 spikes passing.

## Cold open (2 min) — the 3am purchase

Screen recording: a Claude scheduled run fires at 3:04am. No chat window. It checks a price, calls a
wallet, buys shoes for $114.95, writes a receipt. Cut to the phone on a nightstand, face down, dark.
**"No human was present. Was that okay? By the end of this talk, 'yes' — and you'll know exactly why."**

## Act I — the problem (5 min)

- Agents already act unattended: scheduled routines/tasks are GA on both major assistants.
- The delegation layer under them is missing: today's answer is a stored card and a prayer
  (industry survey: ~93% of agent projects run on unscoped keys).
- What we want from delegation is old: **power of attorney** — bounded, revocable, auditable,
  signed once. Slide: PoA document (1600s) next to the two-box signing split (2026).
  *[diagram: "What the hardware key signs ONCE / what the server signs each draw" — design doc §1]*

## Act II — the architecture, as a story of two keys (8 min)

- One biometric tap signs the **bounds**: ≤$120 · Ghost 17 · until Jul 31 · delegate key K_s.
  The phone's key never signs again; it signed *authority*, not payments.
- The wallet server's key signs each **draw**: exact amount, named merchant, single use.
- Verification is a Russian doll opened outside-in. *[diagram: the doll, §4 / §6]*
- The gift-card trap (how we got here): grant-as-bearer-token → anyone who holds it spends it →
  holder binding → wallet custody. (Audience walks the same reasoning path the design did.)
- The orchestrator holds **nothing**: Claude is a courier between connectors. A fully compromised
  agent can only ask the wallet for in-bounds draws. *[diagram: connector tree, §3]*

## Act III — live demo (10 min) — beats in §15 order

1. **Delegate**: "keep me in Ghost 17s, under $120" → approve page → Face ID → done. (Show the
   consent sheet honestly: today it says "• Payment"; the terms live on the approve page — and that
   gap is an open upstream contribution, which is what open ecosystems are for.)
2. **The price race**: scheduled run watches three stores; ShoeBarn drops to $112 → bought there.
   *"The user never chose the store — the mandate chose the price."*
3. **Refusals, live**: over-cap cart (typed refusal on screen) · revoked intent · replayed draw.
4. **The brewery**: agent tries to buy beer unattended → step-up refusal → **"Delegate actions,
   not identity."** Age never completes without a live human — by policy, not by limitation.
5. Morning summary: receipt, remaining budget, revoke button.

## Act IV — why this is real (and what isn't) (5 min)

- The standards composition slide: **AP2** (mandate chain; its IntentMandate literally says HNP
  fields "will be added" — here they are) × **EUDI SCA TS12** (max_amount / total_amount /
  recurrence — the bounds vocabulary already in the wallet) × **Multipaz** (the device that seals it).
- **Prescriptions**: nature already invented the Intent Mandate — doctor-issued, bounded, N refills,
  revocable, audited. HNP's shape has centuries of precedent; we're making it cryptographic.
- Honesty slide (the fencing): what's real (wire crypto, device signature, issuer chain to a **demo**
  CA, real ledger movement of **fake** money) vs. what's not yet (production PKI, network settlement,
  holder-bound orchestrators). `trust_level` lives in the types, not the marketing.
- The Walmart question (audience will ask anyway): when the agent and the store are the same company,
  the user-signed mandate is the only protection left standing. That's why it must exist.

## Close (2 min)

- Roadmap in one arc: merchant-issued (v0.1, honest-but-weak) → user-signed at one merchant →
  wallet-held across all merchants. Same mandate shape; custody keeps moving toward the user.
- Payment is chapter one: memberships, entitlements, prescriptions — a consent layer for every
  credential a wallet holds.
- CTA: Apache-2.0, Linux Foundation, working reference — the neutral layer everyone needs and
  nobody should own. Come build the wallet role with us.

## Slide inventory (from existing artifacts)

| Slide | Source |
| :-- | :-- |
| PoA two-box signing split | design doc §1 diagram |
| Connector architecture tree | §3 diagram |
| The Russian doll + 5 checks | §4/§6 diagrams |
| Three circles (envelope ⊇ grant ⊇ cart) | conversation 2026-07-01 (redraw) |
| AP2 × TS12 × Multipaz composition | ap2-interop-mapping.md §4 |
| Credential family axes table | design doc §16 |
| Honesty labels in the types | spec.md FR-012/FR-014 |

## Known unknowns before this outline is real

The §12 spikes (on-device ceremony, headless routine auth), the §10 scope decision, and the
multi-vendor beats' build status. The outline degrades gracefully: beats 2–4 of Act III can each be
cut independently; the irreducible core is Act III beats 1 + one refusal + the brewery.
