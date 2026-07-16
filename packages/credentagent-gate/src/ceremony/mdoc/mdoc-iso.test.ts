// Wire-structure + verification tests for the shared ISO 18013-5 org-iso-mdoc
// machinery — ported from main's payment-gate/credential-gate/mdoc-iso.test.ts.
// These prove the crypto is REAL: the canonical CBOR wire shapes, a VALID
// ReaderAuthAll COSE_Sign1 signature (verified with the minted reader cert), and an
// HPKE round-trip → ISO-mdoc parse → policy evaluation. The instant-demo path is
// covered by credential-gate.test.ts; this file pins the actual wire crypto.
//
// trust_level stays presence-only-demo: the reader cert is self-signed (no real
// issuer trust anchor), so the wire/COSE/x509/HPKE crypto is real and verified, but
// the issuer-trust is still demo.
import { describe, it, expect } from "vitest";
import { Encoder, decode as cborDecode, Tag } from "cbor-x";

// Match the implementation's canonical (deterministic) CBOR so reconstructed
// reader-auth bytes are byte-identical — see mdoc-iso.ts.
const canonicalEncoder = new Encoder({ useRecords: false, variableMapSize: true, useTag259ForMaps: false });
const cborEncode = (value: unknown): Buffer => canonicalEncoder.encode(value);
import { createHash } from "node:crypto";
import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256, Aes128Gcm } from "@hpke/core";
import { webcrypto } from "node:crypto";
import { X509Certificate } from "@peculiar/x509";
import {
  buildEncryptionInfo,
  buildDeviceRequest,
  buildSessionTranscript,
  buildMdocRequestParts,
  generateReaderKey,
  decryptDeviceResponse,
  disclosedFromDeviceResponse,
  type MdocDocSpec,
} from "./mdoc-iso.js";
import { evaluateDisclosed } from "../credential-gate/verify.js";
import { mdocDocSpec } from "../credential-gate/doc-spec.js";
import type { DisclosedEntry } from "./mdoc.js";

const AGE_SPEC: MdocDocSpec = mdocDocSpec("age", 21);

// Build a minimal DisclosedEntry array matching what disclosedFromDeviceResponse produces.
function syntheticDisclosed(elementIdentifier: string, elementValue: unknown): DisclosedEntry[] {
  return [{ id: "mdl", format: "mso_mdoc", claims: [{ label: `org.iso.18013.5.1 / ${elementIdentifier}`, value: elementValue }] }];
}

const suite = () => new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() });
const toAB = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe("mdoc-iso wire structures", () => {
  it("EncryptionInfo is ['dcapi', { nonce, recipientPublicKey }]", () => {
    const cose = new Map<number, unknown>([[1, 2], [-1, 1], [-2, Buffer.alloc(32)], [-3, Buffer.alloc(32)]]);
    const { bytes } = buildEncryptionInfo(cose, new Uint8Array(16));
    const decoded = cborDecode(bytes) as unknown[];
    expect(decoded[0]).toBe("dcapi");
    const params = decoded[1] as Record<string, unknown>;
    expect(params.nonce).toBeDefined();
    expect(params.recipientPublicKey).toBeDefined();
  });

  it("DeviceRequest carries version + a tag-24 itemsRequest with the doctype and age elements", () => {
    const dr = cborDecode(buildDeviceRequest(AGE_SPEC)) as { version: string; docRequests: { itemsRequest: Tag }[] };
    expect(dr.version).toBe("1.0");
    const ir = dr.docRequests[0].itemsRequest;
    expect(ir).toBeInstanceOf(Tag);
    expect((ir as Tag).tag).toBe(24);
    const items = cborDecode((ir as Tag).value as Uint8Array) as { docType: string; nameSpaces: Record<string, Record<string, boolean>> };
    expect(items.docType).toBe("org.iso.18013.5.1.mDL");
    expect(items.nameSpaces["org.iso.18013.5.1"]).toHaveProperty("age_over_21");
  });

  it("SessionTranscript = [null, null, ['dcapi', SHA256(CBOR([b64EncInfo, origin]))]]", () => {
    const b64 = "ZW5jaW5mbw";
    const origin = "https://shop.example";
    const st = cborDecode(buildSessionTranscript(b64, origin)) as unknown[];
    expect(st[0]).toBeNull();
    expect(st[1]).toBeNull();
    const handover = st[2] as unknown[];
    expect(handover[0]).toBe("dcapi");
    const expected = createHash("sha256").update(cborEncode([b64, origin])).digest();
    expect(Buffer.from(handover[1] as Uint8Array)).toEqual(expected);
  });
});

// Item 6 — a multi-credential request must carry EVERY credential on the iOS org-iso-mdoc path
// (one docRequest each), documentSets must reference every doc index, and the single ReaderAuthAll
// COSE_Sign1 must sign over ALL itemsRequests. Before the fix the builder emitted a single-element
// docRequests array, so a multi-credential request was truncated to one doc on iOS.
describe("mdoc-iso multi-credential DeviceRequest (item 6 — no iOS truncation)", () => {
  const SPEC_A: MdocDocSpec = { docType: "org.example.license.1", namespace: "org.example.license.1", elements: ["license_active"] };
  const SPEC_B: MdocDocSpec = { docType: "org.example.residency.1", namespace: "org.example.residency.1", elements: ["resident_eu"] };

  it("unsigned DeviceRequest carries ONE docRequest per spec, in order (not just the first)", () => {
    const dr = cborDecode(buildDeviceRequest([SPEC_A, SPEC_B])) as { docRequests: { itemsRequest: Tag }[] };
    expect(dr.docRequests).toHaveLength(2);
    const docTypes = dr.docRequests.map((d) => (cborDecode((d.itemsRequest as Tag).value as Uint8Array) as { docType: string }).docType);
    expect(docTypes).toEqual(["org.example.license.1", "org.example.residency.1"]);
  });

  it("signed DeviceRequest carries every doc, documentSets covers all indices, ReaderAuthAll signs over ALL itemsRequests", async () => {
    const origin = "https://shop.example";
    const parts = await buildMdocRequestParts([SPEC_A, SPEC_B], origin);
    const dr = cborDecode(Buffer.from(parts.data.deviceRequest, "base64url")) as {
      version: string; docRequests: { itemsRequest: Tag }[]; deviceRequestInfo: Tag; readerAuthAll: unknown[][];
    };
    expect(dr.version).toBe("1.1");
    expect(dr.docRequests).toHaveLength(2);

    // One mandatory use case whose documentSets reference EVERY doc index [0, 1].
    const dri = cborDecode((dr.deviceRequestInfo as Tag).value as Uint8Array) as { useCases: { mandatory: boolean; documentSets: number[][] }[] };
    expect(dri.useCases[0].mandatory).toBe(true);
    expect(dri.useCases[0].documentSets[0]).toEqual([0, 1]);

    // The single ReaderAuthAll must sign over the SessionTranscript + BOTH itemsRequest tags.
    const ra = dr.readerAuthAll[0];
    const getKey = (m: unknown, k: number): unknown => (m instanceof Map ? m.get(k) : (m as Record<number, unknown>)[k]);
    const certDer = (getKey(ra[1], 33) as Uint8Array[])[0];
    const transcript = buildSessionTranscript(parts.base64EncryptionInfo, origin);
    const itemsTags = dr.docRequests.map((d) => d.itemsRequest);
    const raaBytes = cborEncode(
      new Tag(Buffer.from(cborEncode(["ReaderAuthenticationAll", cborDecode(transcript), itemsTags, dr.deviceRequestInfo])), 24),
    );
    const sigStructure = cborEncode(["Signature1", Buffer.from(ra[0] as Uint8Array), Buffer.alloc(0), Buffer.from(raaBytes)]);
    const cert = new X509Certificate(certDer);
    const pub = await webcrypto.subtle.importKey("spki", cert.publicKey.rawData, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, ra[3] as Uint8Array, sigStructure);
    expect(ok).toBe(true);
  });
});

describe("mdoc-iso reader authentication (ReaderAuthAll)", () => {
  it("the signed device request carries a VALID ReaderAuthAll COSE_Sign1", async () => {
    const origin = "https://shop.example";
    const parts = await buildMdocRequestParts(AGE_SPEC, origin);
    const dr = cborDecode(Buffer.from(parts.data.deviceRequest, "base64url")) as {
      version: string; docRequests: { itemsRequest: Tag }[]; deviceRequestInfo: Tag; readerAuthAll: unknown[][];
    };
    expect(dr.version).toBe("1.1");
    expect(dr.deviceRequestInfo).toBeInstanceOf(Tag);
    const docReq = dr.docRequests[0];
    expect(docReq.itemsRequest).toBeInstanceOf(Tag);
    const ra = dr.readerAuthAll[0];
    expect(ra).toHaveLength(4);

    // COSE headers are plain CBOR maps (no tag 259) — decode as Map or object.
    const getKey = (m: unknown, k: number): unknown =>
      m instanceof Map ? m.get(k) : (m as Record<number, unknown>)[k];
    // protected header = {1: ES256(-7)}
    const ph = cborDecode(ra[0] as Uint8Array);
    expect(getKey(ph, 1)).toBe(-7);
    // x5chain (label 33): array of DER certs, leaf first — [leaf, ca].
    const chain = getKey(ra[1], 33) as Uint8Array[];
    expect(Array.isArray(chain)).toBe(true);
    expect(chain).toHaveLength(2);
    const certDer = chain[0]; // leaf — signs the reader auth
    // detached payload
    expect(ra[2]).toBeNull();

    // Rebuild the signed ReaderAuthenticationAll bytes and VERIFY the signature.
    const transcript = buildSessionTranscript(parts.base64EncryptionInfo, origin);
    const raaBytes = cborEncode(
      new Tag(Buffer.from(cborEncode(["ReaderAuthenticationAll", cborDecode(transcript), [docReq.itemsRequest], dr.deviceRequestInfo])), 24),
    );
    const sigStructure = cborEncode(["Signature1", Buffer.from(ra[0] as Uint8Array), Buffer.alloc(0), Buffer.from(raaBytes)]);
    const cert = new X509Certificate(certDer);
    const pub = await webcrypto.subtle.importKey(
      "spki", cert.publicKey.rawData, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    const ok = await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      ra[3] as Uint8Array,
      sigStructure,
    );
    expect(ok).toBe(true);
  });

  it("REJECTS a tampered ReaderAuthAll signature (a forged signed request does NOT verify)", async () => {
    const origin = "https://shop.example";
    const parts = await buildMdocRequestParts(AGE_SPEC, origin);
    const dr = cborDecode(Buffer.from(parts.data.deviceRequest, "base64url")) as {
      docRequests: { itemsRequest: Tag }[]; deviceRequestInfo: Tag; readerAuthAll: unknown[][];
    };
    const ra = dr.readerAuthAll[0];
    const getKey = (m: unknown, k: number): unknown => (m instanceof Map ? m.get(k) : (m as Record<number, unknown>)[k]);
    const certDer = (getKey(ra[1], 33) as Uint8Array[])[0];
    const docReq = dr.docRequests[0];

    const transcript = buildSessionTranscript(parts.base64EncryptionInfo, origin);
    const raaBytes = cborEncode(
      new Tag(Buffer.from(cborEncode(["ReaderAuthenticationAll", cborDecode(transcript), [docReq.itemsRequest], dr.deviceRequestInfo])), 24),
    );
    const sigStructure = cborEncode(["Signature1", Buffer.from(ra[0] as Uint8Array), Buffer.alloc(0), Buffer.from(raaBytes)]);
    const cert = new X509Certificate(certDer);
    const pub = await webcrypto.subtle.importKey("spki", cert.publicKey.rawData, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

    // Flip a byte in the signature → it must NOT verify against the same payload.
    const forged = Uint8Array.from(ra[3] as Uint8Array);
    forged[forged.length - 1] ^= 0x01;
    const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, forged, sigStructure);
    expect(ok).toBe(false);
  });
});

describe("mdoc-iso HPKE round-trip → parse → evaluate", () => {
  it("decrypts a wallet response and verifies age_over_21", async () => {
    const reader = await generateReaderKey();
    const { base64 } = buildEncryptionInfo(reader.coseKey, new Uint8Array(16));
    const transcript = buildSessionTranscript(base64, "https://shop.example");

    // Synthetic ISO 18013-5 DeviceResponse disclosing age_over_21 = true.
    const isi = cborEncode({ digestID: 0, random: Buffer.alloc(16), elementIdentifier: "age_over_21", elementValue: true });
    const deviceResponse = cborEncode({
      version: "1.0",
      documents: [{
        docType: "org.iso.18013.5.1.mDL",
        issuerSigned: { nameSpaces: { "org.iso.18013.5.1": [new Tag(isi, 24)] } },
      }],
      status: 0,
    });

    // Wallet side: HPKE-seal the DeviceResponse to the reader's public key.
    const s = suite();
    const pubJwk = { kty: reader.privateJwk.kty, crv: reader.privateJwk.crv, x: reader.privateJwk.x, y: reader.privateJwk.y };
    const recipientPublicKey = await s.kem.importKey("jwk", pubJwk as JsonWebKey, true);
    const sender = await s.createSenderContext({ recipientPublicKey, info: toAB(transcript) });
    const ct = new Uint8Array(await sender.seal(toAB(deviceResponse)));
    const enc = new Uint8Array(sender.enc);
    const responseB64Url = Buffer.from(
      cborEncode(["dcapi", { enc: Buffer.from(enc), cipherText: Buffer.from(ct) }]),
    ).toString("base64url");

    // Reader side: decrypt + parse + evaluate.
    const decrypted = await decryptDeviceResponse({ responseB64Url, readerPrivateJwk: reader.privateJwk, sessionTranscript: transcript });
    const disclosed = disclosedFromDeviceResponse(decrypted);
    const result = evaluateDisclosed("age", disclosed, { minimumAge: 21 });
    expect(result.verified).toBe(true);
    expect(result.trust_level).toBe("presence-only-demo");
  });

  it("REJECTS a response sealed under a DIFFERENT origin's session transcript (HPKE info mismatch)", async () => {
    const reader = await generateReaderKey();
    const { base64 } = buildEncryptionInfo(reader.coseKey, new Uint8Array(16));
    // The wallet seals bound to the ATTACKER's origin transcript…
    const attackerTranscript = buildSessionTranscript(base64, "https://evil.example");
    // …but the reader rebuilds the transcript for ITS origin.
    const readerTranscript = buildSessionTranscript(base64, "https://shop.example");

    const isi = cborEncode({ digestID: 0, random: Buffer.alloc(16), elementIdentifier: "age_over_21", elementValue: true });
    const deviceResponse = cborEncode({
      version: "1.0",
      documents: [{ docType: "org.iso.18013.5.1.mDL", issuerSigned: { nameSpaces: { "org.iso.18013.5.1": [new Tag(isi, 24)] } } }],
      status: 0,
    });
    const s = suite();
    const pubJwk = { kty: reader.privateJwk.kty, crv: reader.privateJwk.crv, x: reader.privateJwk.x, y: reader.privateJwk.y };
    const recipientPublicKey = await s.kem.importKey("jwk", pubJwk as JsonWebKey, true);
    const sender = await s.createSenderContext({ recipientPublicKey, info: toAB(attackerTranscript) });
    const ct = new Uint8Array(await sender.seal(toAB(deviceResponse)));
    const enc = new Uint8Array(sender.enc);
    const responseB64Url = Buffer.from(cborEncode(["dcapi", { enc: Buffer.from(enc), cipherText: Buffer.from(ct) }])).toString("base64url");

    // AES-128-GCM under HKDF with a different `info` → authentication fails to open.
    await expect(
      decryptDeviceResponse({ responseB64Url, readerPrivateJwk: reader.privateJwk, sessionTranscript: readerTranscript }),
    ).rejects.toThrow();
  });
});

// The disclosure policy must reject token-presence bypasses on the org-iso-mdoc path.
describe("evaluateDisclosed bypass guards on the org-iso-mdoc path", () => {
  it("FAILS when age_over_21 is explicitly false (token-presence does not prove age)", () => {
    expect(evaluateDisclosed("age", syntheticDisclosed("age_over_21", false), { minimumAge: 21 }).verified).toBe(false);
  });

  it("FAILS a 21+ gate when only age_over_18 = true is disclosed (wrong threshold)", () => {
    expect(evaluateDisclosed("age", syntheticDisclosed("age_over_18", true), { minimumAge: 21 }).verified).toBe(false);
  });

  it("FAILS closed when no age claim is disclosed at all", () => {
    expect(evaluateDisclosed("age", [], { minimumAge: 21 }).verified).toBe(false);
  });
});
