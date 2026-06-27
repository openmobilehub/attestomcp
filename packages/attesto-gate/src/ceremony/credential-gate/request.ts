// REAL signed OpenID4VP request for a credential (age / membership) gate. Faithfully
// ported from the demo's payment-gate/credential-gate/request.ts — like the
// dc-payment request but with NO transaction_data (age/membership is not a payment,
// so there is no amount to bind). It mints a reader cert (@peculiar/x509), an
// ephemeral ECDH response-encryption key, a fresh nonce, and ES256-signs the
// verifier-bound request object (jose.SignJWT). The nonce is sealed alongside the
// decryption key (sealReaderContext, a JWE) so /verify can require the wallet's
// response to be bound to THIS request — not merely decryptable.
//
// The crypto here is REAL (signed request, origin/RP binding, sealed nonce + key);
// the issuer TRUST ANCHOR is not (the reader cert is self-signed) — trust_level
// stays presence-only-demo.
import * as jose from "jose";
import type { Origin } from "../origin.js";
import { makeReaderCert, makeEncryptionKey } from "../mdoc/reader.js";
import { sealReaderContext } from "../mdoc/readerContext.js";
import { buildCredentialDcql, type CredentialDcqlOpts, type CredentialKind } from "./dcql.js";
import type { DcqlQuery } from "../../types.js";

export interface SignedCredentialRequest {
  protocol: "openid4vp-v1-signed";
  /** The ES256-signed OpenID4VP request JWT (real). */
  request: string;
  /** The DCQL embedded in the signed request (echoed for callers/tests). */
  dcql_query: DcqlQuery;
  /** Sealed reader context (ECDH key + nonce) carried to /verify. */
  readerContextToken: string;
  trust_level: "presence-only-demo";
}

/** Build the REAL signed OpenID4VP request descriptor for one credential kind. */
export async function buildCredentialRequest(
  kind: CredentialKind,
  origin: Origin,
  secret: string,
  opts: CredentialDcqlOpts = {},
): Promise<SignedCredentialRequest> {
  const { x5c, privateKey } = await makeReaderCert(origin.rpID);
  const { encJwk, ecdhPrivateJwk } = await makeEncryptionKey();
  const nonce = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(16)));
  const dcql = buildCredentialDcql(kind, opts);

  const requestObject = {
    response_type: "vp_token",
    response_mode: "dc_api.jwt",
    client_id: `x509_san_dns:${origin.rpID}`,
    expected_origins: [origin.origin],
    nonce,
    dcql_query: dcql,
    client_metadata: {
      vp_formats_supported: { mso_mdoc: { issuerauth_alg_values: [-7], deviceauth_alg_values: [-7] } },
      jwks: { keys: [encJwk] },
    },
  };

  const request = await new jose.SignJWT(requestObject)
    .setProtectedHeader({ alg: "ES256", typ: "oauth-authz-req+jwt", x5c: [x5c] })
    .setIssuedAt()
    .sign(privateKey as unknown as jose.KeyLike);

  // Seal the nonce alongside the decryption key so /verify can require the wallet's
  // response to be bound to THIS request (apu/apv check), not just decrypt.
  const readerContextToken = await sealReaderContext({ ecdhPrivateJwk, transactionDataB64: "", nonce }, secret);
  return { protocol: "openid4vp-v1-signed", request, dcql_query: dcql, readerContextToken, trust_level: "presence-only-demo" };
}
