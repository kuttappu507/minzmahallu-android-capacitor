/*
 * Tamper-evident audit chain — pure helpers (no DB access).
 *
 * Every audit event gets an `entry_hash` computed over its own fields PLUS the
 * previous event's `entry_hash`. Because each row's hash binds to the row
 * before it, editing, deleting or reordering any row breaks the chain and is
 * detected by verifyAuditChain(). This is the standard lightweight
 * hash-chaining approach for append-only logs (no blockchain needed).
 *
 * Rows written before this feature existed have NULL hashes and are treated as
 * "legacy anchors": verification skips them and restarts the chain from the
 * first hashed row after them.
 */
import crypto from "node:crypto";

export interface AuditFields {
  userId: number | null;
  username: string;
  action: string;
  module: string;
  entityId: number | null;
  description: string;
  metadata: string;
}

export interface AuditChainRow {
  id: number | string;
  prev_hash: string | null;
  entry_hash: string | null;
  user_id?: number | null;
  username?: string | null;
  action?: string | null;
  module?: string | null;
  entity_id?: number | null;
  description?: string | null;
  metadata?: string | null;
  [key: string]: unknown;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Compute the entry hash for an audit event.
 * Deterministic: same inputs → same hash.
 */
export function computeEntryHash(prevHash: string | null, fields: AuditFields): string {
  const payload = [
    prevHash ?? "",
    fields.userId ?? null,
    fields.username,
    fields.action,
    fields.module,
    fields.entityId ?? null,
    fields.description,
    fields.metadata,
  ];
  return crypto.createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

/** Extract the canonical fields from a row (legacy rows may be missing some). */
function fieldsFromRow(row: AuditChainRow): AuditFields {
  return {
    userId: (row.user_id ?? null) as number | null,
    username: String(row.username ?? ""),
    action: String(row.action ?? ""),
    module: String(row.module ?? ""),
    entityId: (row.entity_id ?? null) as number | null,
    description: String(row.description ?? ""),
    metadata: String(row.metadata ?? ""),
  };
}

export interface VerifyResult {
  /** true when every hashed row matches its predecessor link. */
  intact: boolean;
  /** number of hashed rows successfully verified. */
  verified: number;
  /** number of legacy rows (written before hashing existed). */
  legacyRows: number;
  /** id of the first row where the chain broke (null when intact). */
  brokenAtId: number | string | null;
}

/**
 * Walk the chain from the oldest row to the newest, recomputing each hash and
 * checking it against the stored value AND the previous link.
 */
export function verifyAuditChain(rows: AuditChainRow[]): VerifyResult {
  let verified = 0;
  let legacyRows = 0;
  let previousHash: string | null = null;

  for (const row of rows) {
    const entryHash = row.entry_hash ?? null;
    if (!entryHash) {
      // Legacy row — can't verify, and it resets the chain anchor.
      legacyRows++;
      previousHash = null;
      continue;
    }
    if (row.prev_hash !== previousHash) {
      return { intact: false, verified, legacyRows, brokenAtId: row.id };
    }
    const expected = computeEntryHash(previousHash, fieldsFromRow(row));
    if (expected !== entryHash) {
      return { intact: false, verified, legacyRows, brokenAtId: row.id };
    }
    previousHash = entryHash;
    verified++;
  }
  return { intact: true, verified, legacyRows, brokenAtId: null };
}
