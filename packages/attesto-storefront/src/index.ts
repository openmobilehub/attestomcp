// @openmobilehub/attesto-storefront — the agentic storefront core (v0.1 slice).
//
// The cart → priced-cart → order model an MCP shopping app needs, **catalog-injected**
// (bring your own products). Own-the-code: fork it and edit your catalog. This slice
// is the pure pricing/order model; the MCP tools + widget bundle that render it are
// tracked in the roadmap.

/** Default loyalty discount, in percent. Override per-call via PriceOpts. */
export const LOYALTY_DISCOUNT_PCT = 10;

/** `_meta` keys the storefront tools use to embed the catalog / cart for the widget to read. */
export const CATALOG_META_KEY = "product-picker/catalog";
export const CART_META_KEY = "product-picker/cart";

/** A product review, surfaced by `get-product-reviews`. */
export interface Review {
  author: string;
  rating: number;
  text: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  image: string;
  category: string;
  description: string;
  /** Minimum age to purchase (e.g. 21). Absent = no age restriction. */
  minimumAge?: number;
}

export interface CartItemInput {
  productId: string;
  quantity: number;
}

export interface PricedCartLine {
  id: string;
  name: string;
  unitPrice: number;
  currency: string;
  quantity: number;
  lineTotal: number;
  /**
   * Per-product age threshold (e.g. 21), re-derived from the catalog onto the
   * line. Lets a priced `Order` feed `@openmobilehub/attesto-gate`'s
   * `requirements()` directly — no `toGateOrder` mapping needed.
   */
  minimumAge?: number;
  /** Product category, carried through for custom `.when()` / `appliesTo` predicates. */
  category?: string;
}

export interface PricedCart {
  lines: PricedCartLine[];
  itemCount: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  unknownIds: string[];
  hasAgeRestricted: boolean;
  ageVerified: boolean;
  loyaltyApplied: boolean;
}

export interface Order {
  id: string;
  lines: PricedCartLine[];
  itemCount: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  createdAt: string;
}

export interface PriceOpts {
  ageVerified?: boolean;
  loyaltyApplied?: boolean;
  /** Loyalty discount percent (defaults to LOYALTY_DISCOUNT_PCT). */
  loyaltyDiscountPct?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Price a cart against an injected catalog. Unknown ids are collected, not
 * thrown. Pure — no globals, so the same function serves any storefront.
 */
export function priceCart(items: CartItemInput[], catalog: Product[], opts: PriceOpts = {}): PricedCart {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const lines: PricedCartLine[] = [];
  const unknownIds: string[] = [];
  let hasAgeRestricted = false;
  for (const { productId, quantity } of items) {
    const product = byId.get(productId);
    if (!product) {
      unknownIds.push(productId);
      continue;
    }
    if (quantity <= 0) continue;
    if (product.minimumAge != null) hasAgeRestricted = true;
    lines.push({
      id: product.id,
      name: product.name,
      unitPrice: product.price,
      currency: product.currency,
      quantity,
      lineTotal: round2(product.price * quantity),
      // Re-derived onto the line so a priced Order is gate-ready (inv #2).
      ...(product.minimumAge != null ? { minimumAge: product.minimumAge } : {}),
      category: product.category,
    });
  }
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);
  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  const loyaltyApplied = !!opts.loyaltyApplied;
  const pct = opts.loyaltyDiscountPct ?? LOYALTY_DISCOUNT_PCT;
  const discount = loyaltyApplied ? round2(subtotal * (pct / 100)) : 0;
  const total = round2(subtotal - discount);
  const currency = lines[0]?.currency ?? "USD";
  return {
    lines,
    itemCount,
    subtotal,
    discount,
    total,
    currency,
    unknownIds,
    hasAgeRestricted,
    ageVerified: !!opts.ageVerified,
    loyaltyApplied,
  };
}

/** The strictest minimum age across the cart's products, or null if none. */
export function requiredAgeForLines(lines: { id: string }[], catalog: Product[]): number | null {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  let max: number | null = null;
  for (const { id } of lines) {
    const m = byId.get(id)?.minimumAge;
    if (m != null && (max === null || m > max)) max = m;
  }
  return max;
}

/** Snapshot a priced cart into an immutable order. */
export function createOrder(items: CartItemInput[], id: string, catalog: Product[], opts: PriceOpts = {}): Order {
  const { lines, itemCount, subtotal, discount, total, currency } = priceCart(items, catalog, opts);
  return { id, lines, itemCount, subtotal, discount, total, currency, createdAt: new Date().toISOString() };
}

/** Look up a product by id in the injected catalog. */
export function getProduct(catalog: Product[], productId: string): Product | undefined {
  return catalog.find((p) => p.id === productId);
}

/** Reviews for a product, from the injected reviews map (empty if none). */
export function getReviews(reviews: Record<string, Review[]> | undefined, productId: string): Review[] {
  return reviews?.[productId] ?? [];
}

/** A tiny runnable catalog (incl. one age-restricted item) so the package demos itself. */
// Real keyword-matched product photos via loremflickr (a single CSP domain that
// redirects within itself); `lock` pins a stable image per product.
export const SAMPLE_CATALOG: Product[] = [
  {
    id: "aurora-headphones",
    name: "Aurora Wireless Headphones",
    price: 199.0,
    currency: "USD",
    image: "https://loremflickr.com/400/300/headphones?lock=1",
    category: "Audio",
    description: "Over-ear ANC headphones with 40h battery life.",
  },
  {
    id: "oak-whiskey",
    name: "Oak Reserve Whiskey Collection",
    price: 124.0,
    currency: "USD",
    image: "https://loremflickr.com/400/300/whiskey,bottle?lock=2",
    category: "Beverages",
    description: "Trio of small-batch aged whiskeys. 21+ only.",
    minimumAge: 21,
  },
  {
    id: "drift-mouse",
    name: "Drift Wireless Mouse",
    price: 49.0,
    currency: "USD",
    image: "https://loremflickr.com/400/300/computer,mouse?lock=3",
    category: "Electronics",
    description: "Ergonomic silent-click wireless mouse, 6-month battery.",
  },
  {
    id: "celebration-champagne",
    name: "Celebration Champagne Duo",
    price: 89.0,
    currency: "USD",
    image: "https://loremflickr.com/400/300/champagne?lock=4",
    category: "Beverages",
    description: "Brut champagne duo with two crystal flutes. 21+ only.",
    minimumAge: 21,
  },
  {
    id: "summit-backpack",
    name: "Summit Trail Backpack",
    price: 129.0,
    currency: "USD",
    image: "https://loremflickr.com/400/300/backpack?lock=5",
    category: "Outdoors",
    description: "35L weatherproof hiking backpack with a stowaway rain cover.",
  },
  {
    id: "lumen-desk-lamp",
    name: "Lumen LED Desk Lamp",
    price: 59.0,
    currency: "USD",
    image: "https://loremflickr.com/400/300/desk,lamp?lock=6",
    category: "Home",
    description: "Dimmable LED desk lamp with a USB-C charging base.",
  },
];
