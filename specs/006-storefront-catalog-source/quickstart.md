# Quickstart: Dynamic Catalog Source

## Static (unchanged, zero-config)

```ts
import { createStorefront, SAMPLE_CATALOG } from "@openmobilehub/attestomcp-storefront/server";

const store = createStorefront({ catalog: SAMPLE_CATALOG }); // or omit `catalog`
```

No Firebase, no async, no behavior change.

## Live catalog (Firestore)

```ts
import { createStorefront } from "@openmobilehub/attestomcp-storefront/server";
import { firestoreCatalog } from "@openmobilehub/attestomcp-storefront/firestore";

const store = createStorefront({
  catalog: firestoreCatalog({
    collection: "products",   // Firestore collection of product docs
    ttlMs: 300_000,           // 5-min cache
    // credential: { projectId, clientEmail, privateKey }  // or rely on ADC
  }),
});
```

Install the optional peer dep only for this path: `npm i firebase-admin`.

### Product doc shape

| field | required | notes |
| :-- | :-- | :-- |
| `name` | yes | non-empty string |
| `price` | yes | finite number ≥ 0 |
| `currency` | no | defaults to `"USD"` |
| `image` / `category` / `description` | no | default `""` |
| `minimumAge` | no | non-negative integer — drives the age gate |

A malformed / negative-price doc **fails the load** (never silently dropped).

## Testing without Firebase

Inject a fake Firestore — no `firebase-admin` needed:

```ts
const store = createStorefront({ catalog: firestoreCatalog({ client: fakeFirestore }) });
```

## Fail-closed behavior

- Empty / unreachable **cold** load → server returns **503** (never serves an empty catalog).
- Failed **refresh** with a prior good load → serves **last-known-good** for one TTL.
