// The passkey rail's WebAuthn step (US2) — extracted from the demo's
// payment-gate/passkey/verify.ts. A single registration ceremony is the
// authorization gesture: the challenge is recovered from the signed token
// (stateless — survives an options→verify instance split), and the assertion is
// verified against THIS server's origin/RP-ID with user verification required
// (invariant 6). The signing secret is the injected `signingKey` seam (mount()
// requires a stable one — D6), never a process global.
//
// Trust is PRESENCE-ONLY (Principle VII / FR-011): the attestation flow is real,
// but the mandate it feeds (mandate.ts) is dev-signed, not key-bound — a flow
// demo, not a real safety control.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { issueChallenge, verifyChallenge } from "../challengeToken.js";
import type { Origin } from "../origin.js";
import type { VerifiedAuthenticator } from "../mandate.js";

const RP_NAME = "Attesto Gate";

// Build registration options + a signed challenge token. userID is ephemeral —
// we never persist the credential, so a fresh random user each time is fine.
// crossDevice pins authenticatorAttachment to "cross-platform", which removes the
// local Touch ID option so the browser goes straight to the phone/QR (caBLE) path.
export async function buildRegistrationOptions(
  origin: Origin,
  secret: string,
  opts: { crossDevice?: boolean } = {},
) {
  const { challenge, token } = issueChallenge(secret);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: origin.rpID,
    userName: "attesto-gate-user",
    challenge: Buffer.from(challenge, "base64url"),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
      ...(opts.crossDevice ? { authenticatorAttachment: "cross-platform" as const } : {}),
    },
  });
  return { options, challengeToken: token };
}

export async function verifyPasskeyAssertion(args: {
  response: RegistrationResponseJSON;
  challengeToken: string;
  origin: Origin;
  secret: string;
}): Promise<VerifiedAuthenticator> {
  // Recover + validate the sealed, time-limited nonce FIRST — a forged or expired
  // token is rejected before any attestation parsing (invariant 6).
  const expectedChallenge = verifyChallenge(args.challengeToken, args.secret);
  const verification = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge,
    expectedOrigin: args.origin.origin,
    expectedRPID: args.origin.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("registration not verified");
  }
  const info = verification.registrationInfo;
  return {
    credentialID: info.credential.id,
    userVerified: true,
    credentialDeviceType: info.credentialDeviceType,
    credentialBackedUp: info.credentialBackedUp,
  };
}
