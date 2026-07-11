# Morning brief — demo-PKI overnight build

Branch `feat/demo-pki` (worktree `attestomcp-demo-pki`). **Nothing pushed, nothing
deployed, phone untouched.** Six commits, working tree clean. Everything below is
**verified at the file/CBOR level only — NONE of it has touched a real wallet.**

## TL;DR

All five tasks landed. The pipeline runs end to end: `gen-pki.sh` builds an ISO
18013-5 demo PKI → a Kotlin jvmTest mints four `.mpzpass` credentials signed by that
PKI's Document Signer → a second jvmTest builds a signed VICAL + RICAL → `build_site.py`
assembles a Vercel-ready download page. I confirmed, by decoding the actual bytes, that
every credential's `x5chain` chains to the demo IACA (SKI `5C:47:57…`), the mDL carries
`age_over_18/21/65 = true`, and the VICAL/RICAL wrap that same IACA/reader and
signature-verify. What I **could not** do is import any of it into the Multipaz wallet or
run a ceremony — that's your device step.

## Per-task status

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Card art (#50) | **DONE** | 5 PNGs, `cardart/make_cards.py` (PIL). Verified visually. |
| 2 | OpenSSL PKI (#49) | **DONE** | `gen-pki.sh` + `openssl.cnf`. Profiles mirror Multipaz; both chains verify. |
| 3 | Site (#52) | **DONE (built, not deployed)** | `site/build_site.py` → `index.html` + `vercel.json`. |
| 4 | Mint set (#50) | **DONE** | 4 `.mpzpass`, signed by the demo DS. CBOR-verified claims + DS/IACA. |
| 5 | VICAL/RICAL (#49) | **DONE** | `utopia.vical` + `utopia.rical`, signed by the list signer, round-trip parsed. |

Both KMP jvmTests compiled and ran green (`BUILD SUCCESSFUL`) on the first serious
attempt — no thrash.

## What is UNVERIFIED (say it plainly)

I ran on your Mac with no phone in the loop. So, against the real Multipaz wallet,
**all of the following is unverified**:

- That the wallet **accepts the cert profiles** (my extensions/criticality choices are
  mirrored from Multipaz's own generators and decode correctly, but the wallet's own
  acceptance is untested).
- That the wallet **imports and displays the `.mpzpass`** files and holds them without error.
- That a ceremony **shows no red trust warning** — the whole point of the VICAL/RICAL — is
  completely untested.
- **The VICAL/RICAL import mechanism itself.** I made them downloadable CBOR files, but I do
  not know how the Multipaz wallet ingests a VICAL/RICAL (file-open? a settings import? adb?
  a deep link?). If it isn't "download and open," the files are still correct — only the
  delivery path in the site's step-1 instructions may be wrong.
- The **Vercel `Content-Type`** for `.mpzpass` (`application/vnd.multipaz.mpzpass`) is my
  best guess at what triggers the Android wallet handler; unverified.

The wire crypto is real, but this is **presence-only demo trust** — a self-generated IACA,
not a real issuer. Don't present a passing gate as a real safety/payment control.

## Your remaining steps

1. **Deploy the site (#52).** From `tools/demo-pki/site/`: run `python3 build_site.py`
   (stages `out/*` into `site/credentials/` and `site/trust/` — they're gitignored, so
   this must run before every deploy), then `vercel` (needs your auth). Optionally set a
   real host first — but read the ordering warning below before changing `BASE_URL`.
2. **Trust on the phone (#51).** Get `utopia.vical` + `utopia.rical` into the wallet's
   trust store (confirm the real import path — see UNVERIFIED). Then open each `.mpzpass`
   with the Multipaz wallet to add the credential.
3. **Run a ceremony cross-device** and confirm each gate is satisfied by the matching card
   with **no red trust warning**. That is the real acceptance test none of this has passed yet.
4. If the wallet rejects a cert or credential, check `openssl.cnf` (documented profile
   choices) and the mint claims against what the wallet expects, and adjust.

I also left **two throwaway jvmTests in your local multipaz checkout** (uncommitted there):
`~/tools/git/multipaz/multipaz/src/jvmTest/kotlin/org/multipaz/mpzpass/DemoCredentialMintTest.kt`
and `DemoTrustListTest.kt`. Canonical copies live in `tools/demo-pki/mint/`. Delete the
multipaz-local copies whenever; they don't affect multipaz's tracked files (that dir was
already untracked).

## ⚠️ Pipeline ordering (important)

`gen-pki.sh` → mint → trust-lists must run **in that order**, and **re-running `gen-pki.sh`
mints brand-new random keys**, which orphans the already-built `.mpzpass` and VICAL/RICAL
(they were signed by the previous keys). So:

- **Don't** re-run `gen-pki.sh` unless you then also re-run both jvmTests and `build_site.py`.
- Changing `BASE_URL` requires re-running `gen-pki.sh` → therefore a full re-mint. The
  IssuerAltName/CRL URIs **don't need to resolve** for the demo, so the simplest path is to
  **leave `BASE_URL` as the placeholder** and avoid re-minting.

## File map

```
tools/demo-pki/
  openssl.cnf              # ISO 18013-5 cert profiles (extension sections)
  gen-pki.sh               # reproducible PKI generator (OpenSSL 3.x)
  .gitignore               # ignores keys/ , site/{credentials,trust}/
  certs/                   # PUBLIC certs (committed) — match out/ artifacts
    iaca-cert.pem  ds-cert.pem  ds-chain.pem
    reader-root-cert.pem  reader-cert.pem  list-signer-cert.pem
  keys/                    # PRIVATE keys — GITIGNORED, live only on this machine
    iaca-key.pem  ds-key.pem  reader-root-key.pem  reader-key.pem  list-signer-key.pem
  cardart/
    make_cards.py          # PIL card generator
    card-mdl.png  card-age.png  card-membership.png  card-payment.png  card-professional.png
  mint/                    # committed COPIES of the jvmTests + verifier + how-to
    DemoCredentialMintTest.kt   DemoTrustListTest.kt
    inspect_mpzpass.py     README.md
  out/                     # built deliverables (committed)
    mdl.mpzpass  payment.mpzpass  membership.mpzpass  professional-license.mpzpass
    utopia.vical  utopia.rical
  site/                    # Vercel-ready static site (built, NOT deployed)
    build_site.py  index.html  vercel.json
    credentials/ trust/    # gitignored staging (build_site.py populates)
MORNING-BRIEF.md           # this file
```

## Decisions I made (sanity-check these)

- **OpenSSL 3.6.2** (`/opt/homebrew/opt/openssl@3/bin/openssl`), not macOS LibreSSL — LibreSSL
  is too old for the ISO EKU OID + `issuerAltName=URI:` syntax. `gen-pki.sh` defaults to it;
  override with `OPENSSL=…`.
- **Curve P-256 / ecdsa-with-SHA256** throughout (matches the harness DS; most compatible for mDL).
- **Cert profiles mirror Multipaz `MdocUtil`** (I read the source): KeyUsage **critical**
  (keyCertSign+cRLSign on roots, digitalSignature on leaves); BasicConstraints **critical**
  CA:TRUE,pathlen:0 on roots, absent on leaves; **EKU marked CRITICAL** —
  `1.0.18013.5.1.2` on DS, `1.0.18013.5.1.6` on reader (Multipaz sets critical=true, matching
  ISO Table B.3/B.7); IssuerAltName URI on IACA, copied to DS; CRL DP on all four.
- **DS validity 455 days** (under ISO Table B.3's 457-day cap). **notBefore backdated 2 days**
  so the mdoc MSO (`signedAt = now−1day`, from the harness) sits inside the DS window. Verified
  the DS SKI = the AKI the DS references = the IACA SKI.
- **Doctypes corrected to what the ceremony actually requests** (I traced the gate's DCQL):
  membership `org.multipaz.loyalty.1`, payment `org.multipaz.payment.sca.1`. The policy-builder
  placeholders (`org.openwallet.payment.1`, `org.example.membership.1`) are **not** what the rail
  sends — I fixed the card art + site labels. mDL `org.iso.18013.5.1.mDL` (namespace
  `org.iso.18013.5.1`), pro-license `org.example.license.1`.
- **mDL is hand-built, not the built-in `DrivingLicense` type**, because that type's sample sets
  `age_over_65 = false`. Mine sets `age_over_18/21/65 = true` with a 65+ persona (birth_date
  1955-05-04) so one card covers both the 21+ and 65+ gates. The gate checks `age_over_21 === true`.
- **Payment carries only the 6 issuer-signed instrument claims** (issuer_name,
  payment_instrument_id, masked_account_reference, holder_name, issue_date, expiry_date 2030).
  The amount binding (`transaction_data_hash`) is **device-signed live at ceremony time**, not a
  static claim — so this is the correct minted shape, not a gap.
- **`x5chain = [DS, IACA]`** in each credential (self-contained chain to the trust anchor; a
  verifier can also resolve the IACA via the VICAL). Drop the IACA to `[DS]` if a strict verifier
  wants leaf-only.
- **One self-signed "trust-list signer"** COSE-signs both lists; each wraps the same IACA (VICAL)
  / reader (RICAL) that signed the credentials. RICAL carries its x5chain in the **protected**
  header, VICAL in the **unprotected** — Multipaz's own convention, mirrored.
- **Site**: card art **inlined as data URIs** so the page renders in review with no build step;
  the `.mpzpass`/VICAL/RICAL are external downloads staged by `build_site.py`; anything not yet
  generated renders as an honest disabled "not generated yet" chip instead of a dead link.
  VICAL/RICAL served as `application/cbor` (guess), `.mpzpass` as `application/vnd.multipaz.mpzpass`.

## How I verified (so you can re-check)

- `openssl x509 -text` on each cert → extension/criticality profile as intended; both issued
  chains `openssl verify` OK.
- `tools/demo-pki/mint/inspect_mpzpass.py <file>` decompresses a `.mpzpass`
  (`["MpzPass", raw-deflate(cbor)]`) and prints disclosed claims + DS/IACA subjects. Output
  confirmed: mDL `age_over_18/21/65 = True`, payment 6 claims + future expiry, membership
  non-empty number, pro-license `license_active = True`; every `x5chain` shows
  `Utopia Demo Document Signer` → `Utopia Demo IACA`.
- Both jvmTests `SignedVical.parse` / `SignedRical.parse` with signature verification ON (green),
  and I decoded the COSE payloads to confirm the VICAL wraps the IACA and the RICAL the reader.
- Confirmed no private key is committed (`git grep "BEGIN PRIVATE KEY"` on tracked files = none;
  `keys/` gitignored) and the committed IACA SKI equals the credential-embedded IACA SKI.
