import { describe, it, expect } from "vitest";
import {
  computeEntryHash,
  verifyAuditChain,
  type AuditChainRow,
  type AuditFields,
} from "./audit-chain.js";

const base: AuditFields = {
  userId: 1,
  username: "admin",
  action: "LOGIN",
  module: "auth",
  entityId: 1,
  description: "User logged in",
  metadata: "",
};

function row(id: number, fields: AuditFields, prev: string | null, entry?: string): AuditChainRow {
  const entryHash = entry ?? computeEntryHash(prev, fields);
  return {
    id,
    prev_hash: prev,
    entry_hash: entryHash,
    user_id: fields.userId,
    username: fields.username,
    action: fields.action,
    module: fields.module,
    entity_id: fields.entityId,
    description: fields.description,
    metadata: fields.metadata,
  };
}

describe("audit chain", () => {
  it("computes deterministic hashes", () => {
    const h1 = computeEntryHash(null, base);
    const h2 = computeEntryHash(null, base);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hash changes when any field changes", () => {
    const a = computeEntryHash(null, base);
    const b = computeEntryHash(null, { ...base, description: "User logged out" });
    expect(a).not.toBe(b);
  });

  it("hash binds to the previous hash", () => {
    const first = computeEntryHash(null, base);
    const second = computeEntryHash(first, { ...base, action: "CREATE" });
    const forged = computeEntryHash("0".repeat(64), { ...base, action: "CREATE" });
    expect(second).not.toBe(forged);
  });

  it("verifies an intact chain", () => {
    const r1 = row(1, base, null);
    const r2 = row(2, { ...base, action: "CREATE" }, r1.entry_hash!);
    const r3 = row(3, { ...base, action: "UPDATE" }, r2.entry_hash!);
    const result = verifyAuditChain([r1, r2, r3]);
    expect(result).toEqual({ intact: true, verified: 3, legacyRows: 0, brokenAtId: null });
  });

  it("detects an edited row (recomputed hash mismatch)", () => {
    const r1 = row(1, base, null);
    const r2 = row(2, { ...base, action: "CREATE" }, r1.entry_hash!);
    // Tamper: change the description but keep the stored hash.
    const tampered = { ...r2, description: "Forged entry" };
    const result = verifyAuditChain([r1, tampered]);
    expect(result.intact).toBe(false);
    expect(result.brokenAtId).toBe(2);
  });

  it("detects a deleted row (prev link broken)", () => {
    const r1 = row(1, base, null);
    const r2 = row(2, { ...base, action: "CREATE" }, r1.entry_hash!);
    const r3 = row(3, { ...base, action: "UPDATE" }, r2.entry_hash!);
    // Delete r2 — r3's prev_hash no longer matches r1's hash.
    const result = verifyAuditChain([r1, r3]);
    expect(result.intact).toBe(false);
  });

  it("detects reordering", () => {
    const r1 = row(1, base, null);
    const r2 = row(2, { ...base, action: "CREATE" }, r1.entry_hash!);
    const r3 = row(3, { ...base, action: "UPDATE" }, r2.entry_hash!);
    const result = verifyAuditChain([r1, r3, r2]);
    expect(result.intact).toBe(false);
  });

  it("skips legacy rows and restarts the chain after them", () => {
    const legacy = { id: 0, prev_hash: null, entry_hash: null, user_id: 1, username: "admin" };
    const r1 = row(1, base, null);
    const r2 = row(2, { ...base, action: "CREATE" }, r1.entry_hash!);
    const result = verifyAuditChain([legacy, r1, r2]);
    expect(result).toEqual({ intact: true, verified: 2, legacyRows: 1, brokenAtId: null });
  });
});
