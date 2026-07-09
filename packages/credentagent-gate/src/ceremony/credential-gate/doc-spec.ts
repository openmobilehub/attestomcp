// The ISO 18013-5 doctype / namespace / data-elements the org-iso-mdoc (iOS
// WebKit) path requests per credential kind. The OpenID4VP (Android Chrome) path
// uses the richer DCQL in dcql.ts (which can offer several doctypes); this is the
// single ISO doctype the iOS DeviceRequest carries, since that protocol asks one
// doctype at a time. Kept aligned with dcql.ts so a wallet satisfies either path
// from the same credential.
import type { MdocDocSpec } from "../mdoc/mdoc-iso.js";
import type { CredentialKind } from "./dcql.js";
import type { DcqlQuery } from "../../types.js";

export function mdocDocSpec(kind: CredentialKind, minimumAge = 21): MdocDocSpec {
  if (kind === "age") {
    return {
      docType: "org.iso.18013.5.1.mDL",
      namespace: "org.iso.18013.5.1",
      // Ask for the over-age booleans bracketing the threshold; verify.ts requires
      // the explicit positive at THIS threshold (a sub-threshold proof is refused).
      elements: minimumAge >= 21 ? ["age_over_21", "age_over_18"] : ["age_over_18"],
    };
  }
  return {
    docType: "org.multipaz.loyalty.1",
    namespace: "org.multipaz.loyalty.1",
    elements: ["membership_number", "tier"],
  };
}

/**
 * Derive the ISO org-iso-mdoc single-doctype spec for a CUSTOM credential (007) from
 * its own `request` DcqlQuery — the `dcql()` sugar builds claim paths as
 * `[docType, leaf]`, so the doctype is the credential option's `meta.doctype_value`
 * and the namespace matches it (the same convention the loyalty doctype above uses),
 * with the requested claim leaves as data elements. Keeps the iOS DeviceRequest and
 * the richer OpenID4VP DCQL aligned to one doctype definition, exactly as the
 * built-ins do — no second source of truth.
 */
export function mdocDocSpecFromDcql(dcql: DcqlQuery): MdocDocSpec {
  const cred = dcql.credentials[0];
  const docType = cred?.meta?.doctype_value ?? cred?.id ?? "";
  const elements = (cred?.claims ?? []).map((c) => c.path[c.path.length - 1]).filter((e): e is string => typeof e === "string");
  return { docType, namespace: docType, elements };
}
