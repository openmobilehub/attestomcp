# Wallet-server build guide (desk research, overnight 2026-07-01)

**Status**: research + build plan — implementation remains gated on the maintainer's §10 decision.
**Sources**: `openwallet-foundation/multipaz` + `multipaz-utopia` source (file:line cites below);
MCP Kotlin SDK repo/releases; claude.com connector docs. Companion to
`specs/005-human-not-present/connector-architecture-design.md` (§3, §7) and
`2026-07-01-multipaz-wallet-desk-verification.md`.

---

## 0. Ops finding first: the Utopia stack is HOSTED

Probed 2026-07-01: `https://utopia.multipaz.org/upay/` → 200, `/brewery/` → 200;
`verifier.multipaz.org`, `issuer.multipaz.org`, `dev.wallet.multipaz.org` all live. The default
`enrollment_server_url` in the SDK is `https://issuer.multipaz.org/records`.
⇒ **The PSP/ledger/issuance side of the demo may need no self-hosting at all.** Local docker is
unavailable on this machine (`deployment/README.md` recommends podman — `brew install podman` when/if a
local stack is wanted). What we still must run ourselves: only the **wallet server** (below) and the
**merchant storefronts** (Node, trivial).

## 1. What the SDK gives us for free (the ceremony server is ~stock)

A Multipaz verifier server is `runServer(...)` + `configureVerifier(environment)`:

- **`runServer`** (`multipaz-server/.../runServer.kt:54-93`): config loading
  (`default_configuration.json` + `-param`), storage (jdbc/sqlite/ephemeral), Ktor/Netty, RPC cipher,
  hourly expiry purge.
- **`configureVerifier`** (`multipaz-verifier/.../routing.kt:21-43`) registers the whole ceremony:
  `POST /make_request` (browser sends DCQL + transaction_data → session) · `GET
  /openid4vp_request/{sessionId}` (wallet fetches signed request) · `POST /direct_post/{sessionId}`
  (wallet responds) · `GET /get_result/{sessionId}` (browser polls — note: **pull-based continuation,
  already their pattern too**) · static `www/` frontend.
- **All crypto is done before our code runs** (`verifier.kt:1255-1645`): JWE ECDH-ES decrypt, session
  transcript, mdoc `DeviceResponse.verify`, issuer chain vs `TrustManagerInterface`, claims extraction.
- **Our only mandatory hook** is `VerifierAssistant` (2 suspend methods —
  `customization/VerifierAssistant.kt:9-26`): `processRequest` (compose bounds → TS12 transaction_data,
  mint `intentId`) and `processResponse` (receives verified `VerifierPresentment` incl.
  `presentmentRecord` — store it as the recorded intent artifact, flip status pending→active).

Minimal deps: `multipaz-server`, `multipaz-verifier`, `multipaz-doctypes` (+`multipaz-utopia` for the
DPC/TS12 types), `ktor-server-netty`, kotlinx-serialization/coroutines. The Brewery backend
(`BreweryHandler.kt`) is the copy-from template — a `VerifierAssistant` + one custom route.

## 2. The pieces we actually build

| Component | Effort | Notes |
| :-- | :-- | :-- |
| `IntentVerifierAssistant` | small | compose TS12 payload (`recurrence.mit_options.max_amount`/`total_amount`, payee, window; `transaction_id = intentId` committing to full bounds doc); store presentment on success |
| Intent/policy store | small | bounds doc + status + draw ledger; storage via `runServer`'s `Storage` (sqlite for demo) |
| Draw signer (`K_s`) | small-medium | server EC key: `getServerIdentity(...)` enrollment machinery exists (`ServerIdentity.kt:65-176`) or a self-held P-256 via SDK crypto; sign draw = JWS/COSE over {intentId, payee, exact amount, UPay `transaction_id`} |
| Policy engine | medium | scope/cap/window/cumulative checks + step-up refusal with `approveUrl` (which is just… another `make_request` ceremony URL) |
| MCP layer | small-medium | Kotlin SDK ≥0.14.0: `mcpStreamableHttp(path = "/mcp")` — server-side Streamable HTTP is first-class since 0.9.0; pin version (pre-1.0 churn; the 2026-07-28 MCP spec RC will change transport headers) |
| OAuth layer | **the fiddly part** | SDK ships NO resource-server module — hand-write in Ktor: RFC 9728 protected-resource metadata + 401 `WWW-Authenticate`, RFC 8414 AS metadata, authorization-code + **PKCE S256 mandatory**, DCR (RFC 7591; expect client-record proliferation) or CIMD, `offline_access` refresh tokens **with rotation** (Claude refreshes 5 min early / on 401), RFC 6749 errors on expiry. **No client_credentials — one interactive consent is required**, which aligns with our consent-first model. Lazy auth lets `tools/list` work pre-consent. Deadlines: 10 s (discovery/registration/token), 30 s (refresh). Redirect: `https://claude.ai/api/mcp/auth_callback`. |
| Settlement hand-off | small | draws must carry UPay-compatible `transaction_id`/nonce; later: our `DelegatedTransactionProcessor` speaks the `PaymentProcessor` RPC (`createTransaction`/`commitTransaction` — `PaymentProcessor.kt:17-35`) with a `ServerIdentity.PAYMENT_PROCESSOR` enrollment |

## 3. Risks & open items (build-phase)

1. **Headless refresh tokens are the weakest documented area**: Anthropic publishes no
   scheduled-run auth contract; their own first-party connectors reportedly re-prompt every 1–2 days
   ([claude-ai-mcp#308]). Design: long-lived rotating refresh grants; treat "refresh succeeds
   unattended" as a hard requirement; §12.2 spike still decides go/no-go for the routine demo leg.
2. **MCP Kotlin SDK is 0.x** and the 2026-07-28 spec RC changes Streamable HTTP — pin and budget one
   upgrade.
3. **Enrollment vs self-signed identity**: `getServerIdentity` auto-enrolls against
   `enrollment_server_url` (hosted issuer) or self-signs locally — for the demo trust-list, either works;
   decide when wiring the UPay delegated path.
4. Whether the **hosted** UPay can be used for the delegated flow (it runs stock `TransactionProcessor`,
   human-present only) — the delegated verifier is OURS to run regardless; hosted UPay still serves the
   human-present comparison beat and the ledger (via records RPC) if they allow enrollment.

## 4. Revised effort picture

The ceremony server, crypto, sessions, and frontend pattern are **free** (stock SDK; Brewery is the
template). The wallet server reduces to: one `VerifierAssistant`, one policy module, one signing module,
one MCP module, one OAuth module. Everything but OAuth is small and precedented; OAuth is well-documented
but fiddly (call it the single biggest work item). Confidence on the wallet server moves **70% → ~85%**,
with the §12.2 headless-auth spike as the remaining swing factor.
