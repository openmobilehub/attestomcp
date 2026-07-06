# Requirements Checklist: Dynamic Catalog Source

- [x] `catalog` accepts `Product[] | CatalogSource`; static array stays the zero-config default (FR-001, SC-002)
- [x] `firestoreCatalog(...)` exported via `./firestore`, loads from a Firestore collection via Firebase Admin (FR-002)
- [x] TTL cache, default 5 min (FR-003)
- [x] Fail-closed: empty/unreachable cold load refuses → 503 (FR-004, SC-003)
- [x] Last-known-good on a refresh blip (FR-005)
- [x] Malformed / negative / non-finite-price docs fail the load (FR-006, SC-003)
- [x] Prices + age thresholds re-derived server-side on every completion path; no gate change (FR-007)
- [x] `firebase-admin` optional peer dep, lazily loaded; static + injected-client paths need no dep (FR-008, FR-009)
- [x] Tests cover: static default, load+TTL, cold/empty fail-closed, malformed rejection, last-known-good, missing-dep, server age-gate re-derivation + bypass 403 + 503
- [x] Every fail-closed control has a test that fails when the control is removed (SC-003)
- [ ] Demo (`mcp-apps-shopping-demo`) collapses its three catalog modules onto this source (tracked in the demo repo)
