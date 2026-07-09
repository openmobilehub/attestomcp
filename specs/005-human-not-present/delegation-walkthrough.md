# Delegation Walkthrough — how one biometric tap signs the bounds

**Companion to**: [spec.md](./spec.md) (FR-002 — the two *tentatively planned* v0.2 user-signing ceremonies;
direction discussed 2026-07-01, not settled)

**Status**: Explainer for the **v0.2 line**. In **v0.1 nothing on this page exists yet** — the grant is
server-HMAC only (`trust_level: "server-issued-demo"`). This doc describes where the design goes next and why.

**All payload values are illustrative** (shortened, fake keys/signatures). The structures are real; the bytes
are not.

---

## The whole idea in three sentences

1. **The terms** ("$40 · Blue Bottle · until Jul 31 · agent X") get squeezed into a **fingerprint** (a hash).
2. **Your Face ID tap signs that fingerprint** — so the tap doesn't mean "yes, whatever"; it means "yes,
   *exactly these terms*."
3. **The server checks your signature, then adds its own stamp** and files the grant in a register — so it can
   refuse, revoke, or mark it used later.

Change anything — the price, the agent, the expiry — and the fingerprint changes, so the signature no longer
matches, and everything downstream is refused.

---

## Part 1 — Plain English (no payloads)

### Step 0 — Setup (happened once, in the past)

Your phone holds **two mathematically linked numbers**:

- the **secret key** — locked inside a secure chip; it can never leave; its only job is to sign
- the **public key** — held by the verifying side; its only job is to *check* signatures

*(Who holds the public key differs between the two rails — that's the asymmetry in Part 4.)*

### Step 1 — The terms become a fingerprint

The screen shows the deal. The server squashes those exact words into a **fingerprint** — a short summary with
one property: change *anything* and the fingerprint is completely different. The server asks the phone:
*"please sign this fingerprint."*

### Step 2 — The browser writes its note

Before the phone signs anything, the **browser** — not the page's code — writes a small note: *"fingerprint:
`pYl0ZY…` · site: `shop.bluebottle.com`."* A scam page could lie about which site you're on; the browser is
the neutral referee that records the *real* address bar. The page cannot edit this note.

### Step 3 — Your face unlocks the chip

The chip refuses to sign until Face ID confirms it's you. **Face ID doesn't sign anything** — it unlocks the
chip for *exactly one signature*, then the chip locks again.

### Step 4 — The chip signs

The chip writes its **own** note (*"face was checked ✓ · signature #42"*), glues the two notes into one strip,
and signs across the whole strip with the secret key:

```
signature = sign( secret key , chip's note + browser's note )
```

`sign(...)` produces an unforgeable number that says *"the holder of the secret key approved exactly this
text."* One changed letter anywhere on the strip and the signature stops matching.

Follow the chain: the **signature** covers the **browser's note** → which contains the **fingerprint** → which
stands in for the **terms** (including the agent's key). One tap seals everything — the chip never read the
terms, but it sealed their fingerprint.

### Step 5 — The server checks four things

```
1. Does the signature match the public key on file?      → it was HIS chip        (kills forgery)
2. Does the fingerprint match the terms I showed him?    → THESE terms, unedited  (kills edited terms)
3. Does the note say shop.bluebottle.com?                → tapped on my real site (kills phishing)
4. Does the chip's note say "face checked"?              → not a stolen idle phone
```

### Step 6 — The server adds its stamp and files it

The server bundles `terms + your signature + both notes`, stamps it with **its own key**, and writes one line
in its register: *"grant #123: active, unused."* The stamp means *"I verified this and I'm tracking it."* The
register is what makes the grant **killable** — revoke it or mark it used, and the next attempt is refused no
matter how valid the signatures are.

### The known weak point

The chip signs the fingerprint it's given; it cannot check the screen matched. The gate must therefore be the
party that *builds* the fingerprint from the terms it rendered, and **recomputes** it at verify (check 2).
Screen, fingerprint, and signature must tell the same story.

---

## Part 2 — Same steps, WebAuthn payloads (the passkey rail)

| Plain name | WebAuthn name |
| :-- | :-- |
| the terms | `bounds` (the Intent Mandate body) |
| the fingerprint | `challenge` |
| the browser's note | `clientDataJSON` |
| the chip's note | `authenticatorData` |
| "face was checked ✓" | the `UV` flag |
| the server's stamp | the server `signature` (HMAC via `signingKey`) |

### Step 0 — the public key on file (registered with THIS server, in the past)

```json
{ "user": "user_diego",
  "credentialId": "cred_KzX4",
  "publicKey": { "kty": "EC", "crv": "P-256", "x": "vN4k…", "y": "hJ7m…" } }
```

### Step 1 — the terms → the challenge

```json
{ "grantId": "grant_123",
  "scope": { "payee": "shop.bluebottle.com", "products": ["coffee-beans"] },
  "perActionCap": { "amount": 4000, "currency": "usd" },
  "expiresAt": "2026-07-31",
  "agentKey": { "kty": "EC", "x": "aG3n…", "y": "tK9y…" } }
```

```
challenge = SHA-256(canonical(bounds)) = "pYl0ZY…"     ← the fingerprint
```

```js
navigator.credentials.get({ challenge: "pYl0ZY…" })    // "please sign this"
```

### Step 2 — the browser's note = `clientDataJSON`

```json
{ "type": "webauthn.get",
  "challenge": "pYl0ZY…",                    ← the fingerprint, carried inside
  "origin": "https://shop.bluebottle.com" }  ← the real site, browser-stamped
```

### Step 3 — face check

No payload — the proof appears as one bit in the next step.

### Step 4 — the chip's note = `authenticatorData`, then the signature

```
rpIdHash:  "SZYN5Y…"   ← SHA-256("shop.bluebottle.com") — whose passkey this is
flags:     0x05        ← bit UV=1 : "face was checked ✓"
counter:   42          ← "this is signature #42"
```

```
signature = ECDSA( secret key , authenticatorData + SHA-256(clientDataJSON) )
```

— "sign across the glued strip," with the browser's note squashed to fixed size first.

### Step 5 — what arrives + the four checks

```json
{ "credentialId": "cred_KzX4",
  "clientDataJSON":    "eyJ0eXBl…",
  "authenticatorData": "SZYN5Y…BQAAACo",
  "signature":         "MEUCIQ…" }
```

```
1. ECDSA-verify(signature, publicKey of cred_KzX4)          ✓  his chip
2. clientDataJSON.challenge == SHA-256(bounds I showed)     ✓  these exact terms
3. clientDataJSON.origin == "https://shop.bluebottle.com"   ✓  real site
4. authenticatorData.flags.UV == 1                          ✓  face checked
```

### Step 6 — the grant with the server's stamp

```json
{ "type": "ap2.IntentMandate",
  "id": "grant_123",
  "bounds": { "…exactly the bytes from step 1…": "" },
  "userAssertion": { "…exactly the payload from step 5…": "" },
  "presence": "delegated",
  "alg": "HMAC-SHA256+WebAuthn-ES256",
  "signature": "HMAC(signingKey, everything above)" }
```

```
register:  grant_123 → { revoked: false, consumed: false }
```

**The binding, made literal:** the same bytes appear twice — the `bounds` sit in the grant in the open, *and*
their hash sits inside `clientDataJSON.challenge` under the user's signature. Check 2 compares the two. The
two keys never touch; they both commit to the same bytes, one signature nested inside the other.

---

## Part 3 — Same steps, DPC payloads (the Multipaz / mdoc rail)

| Plain name | DPC / mdoc name |
| :-- | :-- |
| the terms | `bounds` (unchanged) |
| the fingerprint | `nonce` (in the OpenID4VP request) |
| the browser's note | **session transcript** (nonce + origin handover) |
| the chip's note + signature | `deviceAuth` (signed by the **DeviceKey**) |
| the public key on file | ✗ replaced by an **issuer root cert** on a trust list |
| *(new player)* the issuer's voucher | **MSO** — issuer-signed, certifies the DeviceKey |
| the server's stamp | server HMAC (unchanged) |

### Step 0 — nothing about *you* on file; an issuer root instead

The server has never met you. What it holds:

```json
{ "trustList": [ { "issuer": "Visa Issuing CA", "rootCert": "MIIB…" } ] }
```

What your **wallet** holds (provisioned by your bank via Multipaz, once, in the past — CBOR, shown as JSON):

```json
{ "claims":  { "holderName": "Diego Z.", "paymentToken": "tok_4242…" },
  "MSO": {
     "claimHashes": { "holderName": "8fA2…", "paymentToken": "c91D…" },
     "deviceKey": { "kty": "EC", "x": "dV7c…", "y": "qW2p…" },
     "issuerSignature": "…",
     "certChain": ["leaf…", "…root MIIB…"] } }
```

The bank pre-signed the statement: *"these claims, and this device key, belong together."*

### Step 1 — terms → fingerprint (identical to Part 2)

```
bounds = { grantId, scope, perActionCap: $40, expiresAt, agentKey }
nonce  = SHA-256(bounds) = "pYl0ZY…"        ← same trick, new name
```

### Step 2 — the request goes out, the transcript forms

```json
{ "protocol": "openid4vp",
  "nonce": "pYl0ZY…",                       ← the fingerprint rides here
  "client_id": "shop.bluebottle.com",
  "dcql": { "credentials": [ { "format": "mso_mdoc", "doctype": "payment.dpc" } ] } }
```

The **session transcript** is assembled from that nonce + the origin handover (the browser binds who's
asking) — the "browser's note": *fingerprint + real site* in one structure.

### Step 3 — the wallet's consent sheet, face unlocks the DeviceKey

One visible difference from the passkey: the sheet shows **what will be disclosed** — *"Share payment token +
name with shop.bluebottle.com?"* Face ID unlocks the DeviceKey for one signature.

### Step 4 — the device signs the transcript

```
deviceAuth = ECDSA( DeviceKey , sessionTranscript )
             └─ covers: nonce (= bounds fingerprint) + origin
```

The wallet ships one bundle, **encrypted to the server** (the JWE / ECDH-ES wire crypto the `dc-payment` rail
already performs):

```json
{ "issuerSigned": { "claims": "…", "MSO": "…", "certChain": "…" },
  "deviceSigned": { "deviceAuth": "…" } }
```

*(the bank's old voucher + the fresh proof made just now)*

### Step 5 — five checks (one more than the passkey)

```
1. deviceAuth verifies under the DeviceKey             ✓  this device, live, now
2. transcript's nonce == SHA-256(bounds I showed)      ✓  these exact terms
3. transcript's origin == shop.bluebottle.com          ✓  real site
4. DeviceKey == the key certified inside the MSO       ✓  same device the bank vouched for
5. MSO signature chains to a root on my trust list     ✗  ← THE MISSING LINK (v0.3)
```

Check 5 is the asymmetry pinned in FR-002, visible in the data: today there is **no trust list**, so a
self-crafted credential passes checks 1–4. Checks 1–4 still seal the bounds to *a* device — but "who" hangs
entirely on check 5.

### Step 6 — same stamp, weaker label

```json
{ "type": "ap2.IntentMandate",
  "bounds": { "…": "" },
  "userAssertion": { "…the mdoc bundle from step 4…": "" },
  "presence": "delegated",
  "trust_level": "…weaker than the passkey rail's (exact value fixed at v0.2 spec time)…",
  "signature": "HMAC(signingKey, everything above)" }
```

---

## Part 4 — The asymmetry (why the two rails are NOT trust-equivalent)

The two ceremonies look symmetric to the user — screen, Face ID, done. Their trust roots are different shapes:

| | Passkey (WebAuthn) | DPC (Multipaz / mdoc) |
| :-- | :-- | :-- |
| Prior relationship | **with this server** (registration) | **with an issuer** (provisioning); first contact with the server works |
| What's on file at the server | *your* public key | the *issuer's* root cert (a trust list) |
| Chain shape | one hop: *your key, which I filed* | two hops: *a device key → vouched by an issuer → whom I trust* |
| Live at v0.2? | **yes — the full chain works the day it ships** | no — check 5 (issuer chain → trust list) is the **v0.3** anchor; until then: device possession + bounds sealing only, "who" unanchored |
| Honesty obligation | real user signature | **weaker `trust_level` than the passkey rail** (FR-002); never presented as equivalent in UX or docs |

**Why both anyway?** The passkey rail is the strong, shippable user signature *now*. The DPC rail is the
bridge: the same ceremony that is presence-only today becomes issuer-verified the moment the trust anchor
lands (v0.3) — no new UX, one new check.

---

## Where this meets the spec

- **FR-002** — the two ceremonies, the two proof formats the verify-dispatch must handle, and the
  trust-asymmetry obligations.
- **FR-001 / FR-012 / FR-014** — the honesty fields (`presence`, `trust_level`, `disclaimer`) the grant
  carries at every rung.
- **Step 6's register** — the `RevocationStore` seam (FR-009/FR-010): revocation + the atomic single-use
  consume.
- **The agent key inside the bounds** — the holder-binding line (Out of Scope v0.2+): the user's signature
  covers *which agent* may redeem; per-draw proof-of-possession completes it.
