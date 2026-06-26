// Per-order verification store. Keyed by order id — NEVER process-global, so one
// shopper's verification can never unlock another's checkout (Security invariant 4).
// Default is in-process; swap in Redis (Upstash) for serverless by implementing
// VerificationStore.

import type { VerificationRecord, VerificationStore } from "./types.js";

export class MemoryVerificationStore implements VerificationStore {
  private readonly records = new Map<string, VerificationRecord>();

  read(orderId: string): VerificationRecord | undefined {
    return this.records.get(orderId);
  }
  write(orderId: string, record: VerificationRecord): void {
    this.records.set(orderId, record);
  }
  clear(orderId: string): void {
    this.records.delete(orderId);
  }
}
