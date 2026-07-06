// Tests for the pure catalog-source contract (spec 006): staticCatalog + isCatalogSource,
// the normalization the storefront uses to keep a plain array the zero-config default.

import { describe, it, expect } from "vitest";
import { staticCatalog, isCatalogSource, SAMPLE_CATALOG, type CatalogSource } from "./index.js";

describe("staticCatalog", () => {
  it("returns the injected array from both load() and current()", async () => {
    const src = staticCatalog(SAMPLE_CATALOG);
    expect(await src.load()).toBe(SAMPLE_CATALOG);
    expect(src.current()).toBe(SAMPLE_CATALOG);
  });
});

describe("isCatalogSource", () => {
  it("is false for a plain Product[] (the zero-config default) and undefined", () => {
    expect(isCatalogSource(SAMPLE_CATALOG)).toBe(false);
    expect(isCatalogSource([])).toBe(false);
    expect(isCatalogSource(undefined)).toBe(false);
  });

  it("is true for anything with a load() method", () => {
    expect(isCatalogSource(staticCatalog(SAMPLE_CATALOG))).toBe(true);
    const custom: CatalogSource = { load: async () => SAMPLE_CATALOG, current: () => SAMPLE_CATALOG };
    expect(isCatalogSource(custom)).toBe(true);
  });
});
