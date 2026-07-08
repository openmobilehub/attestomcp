# API Contract: Dynamic Catalog Source

## `CatalogSource` (from `@openmobilehub/credentagent-storefront`)

```ts
interface CatalogSource {
  /** Load the current catalog, TTL-cached. Rejects (fail-closed) on a cold/empty load. */
  load(): Promise<Product[]>;
  /** Last-known-good snapshot for synchronous re-price. Throws if never loaded. */
  current(): Product[];
}

function staticCatalog(products: Product[]): CatalogSource;      // never fails
function isCatalogSource(x: Product[] | CatalogSource | undefined): x is CatalogSource;
```

## `firestoreCatalog` (from `@openmobilehub/credentagent-storefront/firestore`)

```ts
interface FirestoreCatalogOptions {
  client?: FirestoreLike;                 // inject a fake / pre-built Admin Firestore (no firebase-admin)
  collection?: string;                    // default "products"
  ttlMs?: number;                         // default 300_000 (5 min)
  credential?: ServiceAccountCredential;  // else Application Default Credentials
  projectId?: string;
  mapDoc?: (id: string, data: Record<string, unknown>) => Product;  // default: validate + reject bad docs
  _load?: FirebaseAdminLoader;            // @internal test seam
}

function firestoreCatalog(options?: FirestoreCatalogOptions): CatalogSource;

interface FirestoreLike {
  collection(path: string): { get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> }> }> };
}
```

## `createStorefront` change

```ts
interface StorefrontOptions {
  catalog?: Product[] | CatalogSource;   // was: Product[]
  // …unchanged
}
```

## Contract tests

| id | assertion | fails if control removed |
| :-- | :-- | :-- |
| CT-1 | static `Product[]` default unchanged; no firebase-admin | — |
| CT-2 | `firestoreCatalog` loads + maps docs; currency defaults USD | — |
| CT-3 | TTL cache serves within `ttlMs`, refetches after | — |
| CT-4 | cold empty load rejects; server 503 | ✅ fail-closed |
| CT-5 | unreachable cold load rejects; server 503 | ✅ fail-closed |
| CT-6 | malformed / negative / non-finite doc fails the load | ✅ validation |
| CT-7 | failed refresh serves last-known-good | ✅ resilience |
| CT-8 | lazy missing-dep error names `firebase-admin` | — |
| CT-9 | age gate re-derived from live docs; gated bypass 403 | ✅ inv 1/2 |
