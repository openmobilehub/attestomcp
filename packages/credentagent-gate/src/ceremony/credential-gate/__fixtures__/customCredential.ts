// Shared custom-credential fixtures for the 007 suites (US1/US2). One definition of the
// worked pack so `generic-credential.test.ts`, `completion.test.ts`, and `mount.test.ts`
// don't each copy-paste it (tasks T002).
import { defineCredential, dcql, gate } from "../../../credentials.js";
import type { Credential } from "../../../types.js";

/** The worked pack: a professional-license gate(), conditional to a `Licensed` line. */
export const professionalLicense: Credential = defineCredential({
  id: "professional_license",
  request: dcql({ docType: "org.example.license.1", claims: ["license_active"] }),
  verify: (c) => c.license_active === true, // explicit positive claim (invariant 5)
  effect: gate(),
  appliesTo: (order) => order.lines.some((l) => l.category === "Licensed"),
  ui: { label: "Professional license", action: "Verify your license" },
});

/** The README's prescription gate — keyed on `requiresRx` (a NON-category field), used to
 *  pin that the completion sweep sees the full re-priced order (the fail-open repro). */
export const prescription: Credential = defineCredential({
  id: "prescription",
  request: dcql({ docType: "org.hl7.prescription.1", claims: ["rx_valid"] }),
  verify: (c) => c.rx_valid === true,
  effect: gate(),
  appliesTo: (order) => order.lines.some((l) => l.requiresRx),
  ui: { label: "Prescription", action: "Verify prescription" },
});
