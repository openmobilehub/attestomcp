// Reader-side key + cert material for the Android-Chrome OpenID4VP path, shared by
// both rails' REAL signed-request builders. Extracted FAITHFULLY from the demo's
// payment-gate/dc-payment/request.ts (makeReaderCert + makeEncryptionKey).
//
// REAL crypto: a P-256 reader certificate is minted with @peculiar/x509 (SAN-DNS =
// RP-ID, SubjectKeyIdentifier required or the wallet's TrustManagerUtil NPEs) and
// an ephemeral P-256 ECDH key the wallet encrypts its response to. The request is
// then ES256-signed (jose.SignJWT) over the verifier-bound request object. The one
// thing NOT yet real is the issuer TRUST ANCHOR — the reader cert is self-signed
// here (as the demo's is), so origin/RP binding is enforced but cross-issuer trust
// is not.
import * as jose from "jose";
import * as x509 from "@peculiar/x509";
import type { webcrypto as NodeWebCrypto } from "node:crypto";

const webcrypto = globalThis.crypto;
x509.cryptoProvider.set(webcrypto);

const SIGN_ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;

export async function makeReaderCert(rpID: string): Promise<{ x5c: string; privateKey: NodeWebCrypto.CryptoKey }> {
  const keys = await webcrypto.subtle.generateKey(SIGN_ALG, true, ["sign", "verify"]);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=${rpID}`,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 86_400_000),
    signingAlgorithm: SIGN_ALG,
    keys,
    extensions: [
      new x509.SubjectAlternativeNameExtension([{ type: "dns", value: rpID }]),
      // The Subject Key Identifier extension is REQUIRED — without it the wallet's
      // TrustManagerUtil does subjectKeyIdentifier!! → NPE.
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  return { x5c: cert.toString("base64"), privateKey: keys.privateKey as unknown as NodeWebCrypto.CryptoKey };
}

// Ephemeral P-256 key the wallet encrypts its response to. Shared by the payment
// and credential gates so both build the response-encryption JWK identically.
export async function makeEncryptionKey(): Promise<{ encJwk: jose.JWK; ecdhPrivateJwk: jose.JWK }> {
  const encKP = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const encPubJwk = await webcrypto.subtle.exportKey("jwk", encKP.publicKey);
  const ecdhPrivateJwk = (await webcrypto.subtle.exportKey("jwk", encKP.privateKey)) as jose.JWK;
  const encJwk = { kty: "EC", crv: "P-256", x: encPubJwk.x, y: encPubJwk.y, use: "enc", alg: "ECDH-ES", kid: "response-encryption-key" } as jose.JWK;
  return { encJwk, ecdhPrivateJwk };
}
