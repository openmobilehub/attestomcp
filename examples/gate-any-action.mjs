// "Gate ANY consequential action with ANY credential" — identity-first, NO checkout.
//
//   npm run build --workspaces       # build the @openmobilehub/credentagent-* packages
//   node examples/gate-any-action.mjs
//
// The storefront example gates a PURCHASE. This one gates a NON-commerce action — an MCP
// tool that releases sensitive records — behind an identity credential, with no payment
// anywhere. Identity leads; commerce is just one of the actions you can gate.
//
// It uses the Mode-B `verification_required` envelope: instead of performing the action, a
// gated tool returns a TYPED REFUSAL the agent drives — share a link, the user proves the
// credential on their phone, the agent re-calls and the action runs. The agent keys on the
// `_credentagent` sentinel (isVerificationRequired) and follows envelopeInstruction.
//
// HONESTY: the envelope + the gating decision are real today. The user proves on the
// `approve_url` PAGE that `credentagent.mount()` serves (see examples/storefront.mjs for the full
// ceremony); a fully page-LESS proving handshake is on the roadmap (ROADMAP.md). trust_level
// is "presence-only-demo" — the wire crypto is real, the issuer trust anchor is not yet, so
// don't put a presence-only gate in front of anything that needs a real safety guarantee.

import {
  buildVerificationRequired,
  isVerificationRequired,
  ageDcql,
} from "@openmobilehub/credentagent-gate";

// A sensitive action an agent might be asked to perform — NOT a purchase. The gate is the
// same shape you'd put in front of "approve-deploy", "file-prescription-refill", or
// "grant-access": prove a credential first, then act.
function releaseRecords(args, ctx) {
  if (!ctx.ageVerified) {
    // Gate any tool call: return the typed refusal instead of doing the action. The
    // "order" here is a $0 ACTION, not a sale — the gate doesn't care that there's no money.
    return buildVerificationRequired({
      order: { id: args.requestId, total: 0, currency: "USD" },
      credential: "age",
      minAge: 21,
      request: ageDcql(),
      approveUrl: `https://example.test/credentagent/credential?order=${args.requestId}&cred=age`,
      gate: "Age over 21",
      detail: "Releasing these records requires proof the requester is 21 or older.",
      resumeTool: "get-record-status",
    });
  }
  return { released: true, subject: args.subject, records: [`record:${args.subject}:summary`] };
}

// 1) Ungated call — the agent receives a verification_required envelope, not the records.
const refusal = releaseRecords({ requestId: "REQ-1", subject: "patient-7" }, { ageVerified: false });
console.log("\n— ungated tool call —");
console.log("  is a verification handshake:", isVerificationRequired(refusal));
console.log("  gate:", refusal.reason.gate, "| trust_level:", refusal.trust_level);
// NOTE: the built-in envelopeInstruction() is worded for the CHECKOUT framing ("buyer",
// "placed") — fine for the storefront, but for a non-commerce action build the agent
// instruction from the envelope's fields directly (action-agnostic). An action-agnostic
// instruction helper is a small follow-up (see ROADMAP).
const instruction =
  `This action is gated. ${refusal.reason.detail} ` +
  `Send the requester this link to prove the credential on their phone: ${refusal.present.approve_url} — ` +
  `then re-call once \`${refusal.resume.tool}\` reports completion. Don't perform the action until then.`;
console.log("  agent instruction:\n   ", instruction);

// 2) After the user proves age on the approve_url page (which credentagent.mount() serves), the
//    agent re-calls the tool and the action runs — no payment ever involved.
const ok = releaseRecords({ requestId: "REQ-1", subject: "patient-7" }, { ageVerified: true });
console.log("\n— after the credential is proven —");
console.log("  ", JSON.stringify(ok), "\n");
