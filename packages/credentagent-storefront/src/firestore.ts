// firestoreCatalog() — a first-class DYNAMIC catalog source for createStorefront().
//
// Loads products from a Firestore collection so a merchant edits the catalog WITHOUT a
// redeploy, with ONE option instead of a hand-written loader:
//
//   import { createStorefront } from "@openmobilehub/credentagent-storefront/server";
//   import { firestoreCatalog } from "@openmobilehub/credentagent-storefront/firestore";
//   const store = createStorefront({ catalog: firestoreCatalog({ collection: "products", ttlMs: 300_000 }) });
//
// `firebase-admin` is an OPTIONAL peer dependency: it is loaded LAZILY, only when a real
// Firestore fetch runs on the credentials path. Importing this module, calling
// `firestoreCatalog`, and the injected-`client` path (tests / a pre-built Firestore) all
// need no dependency (Security-lean static story).
//
// Fail-closed by construction (Security invariant 2 — never trust the order token; prices
// and age thresholds re-derive from THIS source server-side):
//   • a cold/empty load REFUSES rather than serving an empty catalog,
//   • a refresh blip serves the last-known-good snapshot (for one TTL) instead of failing,
//   • a malformed / negative-price doc FAILS the load (never silently drops a product).

import type { CatalogSource, Product } from "./index.js";

// ── the minimal Firestore surface the loader calls (also the injectable test seam) ──

interface FirestoreDoc {
  id: string;
  data(): Record<string, unknown>;
}

/** The slice of a firebase-admin Firestore this source uses (inject a fake in tests). */
export interface FirestoreLike {
  collection(path: string): { get(): Promise<{ docs: FirestoreDoc[] }> };
}

/** Service-account credentials (else Application Default Credentials are used). */
export interface ServiceAccountCredential {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** Optional loader seam so the missing-peer-dependency path is testable without the dep. */
export type FirebaseAdminLoader = (opts: {
  credential?: ServiceAccountCredential;
  projectId?: string;
}) => Promise<FirestoreLike>;

export interface FirestoreCatalogOptions {
  /** Inject a pre-built / fake Firestore instead of firebase-admin creds (tests, custom setups). */
  client?: FirestoreLike;
  /** Firestore collection holding one product per doc. Default `"products"`. */
  collection?: string;
  /** Cache TTL in ms — how long a loaded catalog is served before a refresh. Default 5 min. */
  ttlMs?: number;
  /** Service-account credentials for firebase-admin (else Application Default Credentials). */
  credential?: ServiceAccountCredential;
  /** GCP project id, when not inferable from the credentials / ADC. */
  projectId?: string;
  /** Map a raw Firestore doc to a Product. Default validates + rejects malformed/negative docs. */
  mapDoc?: (id: string, data: Record<string, unknown>) => Product;
  /** @internal Override how `firebase-admin` is loaded (for tests). */
  _load?: FirebaseAdminLoader;
}

const DEFAULT_COLLECTION = "products";
const DEFAULT_TTL_MS = 300_000; // 5 minutes

// ── default doc → Product mapper (fail-closed validation) ───────────────────

function str(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === "string" ? (data[key] as string) : undefined;
}

/**
 * Validate a Firestore doc into a Product. A missing name, a non-finite/negative price, or
 * a bad `minimumAge` THROWS — so the load fails closed (the merchant sees it) rather than
 * silently dropping a product (which could drop an age gate). Currency defaults to USD.
 */
function defaultMapDoc(id: string, data: Record<string, unknown>): Product {
  const name = str(data, "name");
  if (!name) throw new Error(`firestoreCatalog: product "${id}" is missing a string "name".`);

  const price = data.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
    throw new Error(`firestoreCatalog: product "${id}" has an invalid price (must be a finite number ≥ 0).`);
  }

  const minimumAge = data.minimumAge;
  if (minimumAge != null && (typeof minimumAge !== "number" || !Number.isInteger(minimumAge) || minimumAge < 0)) {
    throw new Error(`firestoreCatalog: product "${id}" has an invalid minimumAge (must be a non-negative integer).`);
  }

  return {
    id,
    name,
    price,
    currency: str(data, "currency") ?? "USD",
    image: str(data, "image") ?? "",
    category: str(data, "category") ?? "",
    description: str(data, "description") ?? "",
    ...(minimumAge != null ? { minimumAge: minimumAge as number } : {}),
  };
}

// ── lazy firebase-admin loader ──────────────────────────────────────────────

// Local shapes of the firebase-admin subpath modules, so the loader typechecks WITHOUT the
// (heavy, optional) dependency installed. The module specifiers are held in variables so
// tsc does not statically resolve `firebase-admin/*` — it is an OPTIONAL peer dep, present
// only in a consumer that uses this source. Mirrors redis.ts's lazy loader.
interface FirebaseAdminAppModule {
  getApps(): unknown[];
  initializeApp(opts: unknown): unknown;
  cert(sa: { projectId: string; clientEmail: string; privateKey: string }): unknown;
  applicationDefault(): unknown;
}
interface FirebaseAdminFirestoreModule {
  getFirestore(app: unknown): FirestoreLike;
}

const defaultLoader: FirebaseAdminLoader = async ({ credential, projectId }) => {
  // `: string` (not a literal type) so tsc does not resolve the optional peer at compile time.
  const appSpecifier: string = "firebase-admin/app";
  const firestoreSpecifier: string = "firebase-admin/firestore";
  const appMod = (await import(appSpecifier)) as FirebaseAdminAppModule;
  const firestoreMod = (await import(firestoreSpecifier)) as FirebaseAdminFirestoreModule;
  const existing = appMod.getApps();
  const app = existing.length
    ? existing[0]
    : appMod.initializeApp({
        credential: credential
          ? appMod.cert({ projectId: credential.projectId, clientEmail: credential.clientEmail, privateKey: credential.privateKey })
          : appMod.applicationDefault(),
        ...(projectId ? { projectId } : {}),
      });
  return firestoreMod.getFirestore(app);
};

/**
 * Build a {@link CatalogSource} backed by a Firestore collection. Pass the result as
 * `createStorefront({ catalog })`. Supply either firebase-admin `credential` (or rely on
 * Application Default Credentials) or an injected `{ client }`.
 */
export function firestoreCatalog(options: FirestoreCatalogOptions = {}): CatalogSource {
  const collection = options.collection ?? DEFAULT_COLLECTION;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const mapDoc = options.mapDoc ?? defaultMapDoc;

  let db: FirestoreLike | undefined;
  let lastGood: Product[] | undefined;
  let loadedAt = 0;
  let inflight: Promise<Product[]> | undefined;

  // Resolve the Firestore once: an injected client wins; otherwise lazily load
  // firebase-admin (deferred so import/construction need no dependency).
  const getDb = async (): Promise<FirestoreLike> => {
    if (options.client) return options.client;
    if (!db) {
      const load = options._load ?? defaultLoader;
      db = await load({ credential: options.credential, projectId: options.projectId }).catch((cause) => {
        throw new Error(
          "firestoreCatalog: `firebase-admin` is required for the credentials path but could not be loaded. " +
            "Install it (`npm i firebase-admin`) or pass a `client`.",
          { cause },
        );
      });
    }
    return db;
  };

  const fetchNow = async (): Promise<Product[]> => {
    const database = await getDb();
    const snap = await database.collection(collection).get();
    const products = snap.docs.map((doc) => mapDoc(doc.id, doc.data()));
    if (products.length === 0) {
      throw new Error(`firestoreCatalog: collection "${collection}" is empty — refusing to serve an empty catalog (fail-closed).`);
    }
    return products;
  };

  const load = async (): Promise<Product[]> => {
    // Serve the cached catalog while it is fresh.
    if (lastGood && Date.now() - loadedAt < ttlMs) return lastGood;
    // Dedup concurrent refreshes (the prime middleware runs per request).
    if (!inflight) {
      inflight = fetchNow()
        .then((products) => {
          lastGood = products;
          loadedAt = Date.now();
          return products;
        })
        .catch((err) => {
          // Refresh blip with a prior good load: serve last-known-good and back off one
          // TTL. Cold load (no prior good): FAIL CLOSED — propagate so no empty catalog serves.
          if (lastGood) {
            loadedAt = Date.now();
            return lastGood;
          }
          throw err;
        })
        .finally(() => {
          inflight = undefined;
        });
    }
    return inflight;
  };

  return {
    load,
    current: () => {
      if (!lastGood) {
        throw new Error("firestoreCatalog: catalog not loaded yet — call load() first (fail-closed backstop).");
      }
      return lastGood;
    },
  };
}
