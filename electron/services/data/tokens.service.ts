/* Tokens module — split out of data.service.ts (public API unchanged via the facade). */

import { randomInt } from "node:crypto";
import { all, getDB, one, run, scalar } from "../../db/connection.js";
import { todayIST } from "../ist-date.js";
import { audit } from "./audit.service.js";

const TOKEN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateTokenCode(): string {
  // Use crypto.randomInt() instead of Math.random() — token codes are security-sensitive
  // (they are presented at event entry) and must be unguessable.
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += TOKEN_ALPHABET[randomInt(0, TOKEN_ALPHABET.length)];
  }
  return code;
}

function generateUniqueTokenCode(existing: Set<string>): string {
  let code = generateTokenCode();
  let attempts = 0;
  while (existing.has(code) && attempts < 1000) {
    code = generateTokenCode();
    attempts++;
  }
  return code;
}

export const tokens = {
  // ===== Events =====
  listEvents: () => all<any>("SELECT * FROM token_events ORDER BY event_date DESC, id DESC"),
  getEvent: (id: number) => one<any>("SELECT * FROM token_events WHERE id = ?", [id]),
  createEvent: (data: any) => {
    const { id } = run(
      `INSERT INTO token_events (event_name, event_type, event_date, event_time, venue, description, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [data.eventName, data.eventType || "general", data.eventDate, data.eventTime || "", data.venue || "", data.description || ""]
    );
    return { id };
  },
  updateEvent: (id: number, data: any) => {
    const existing = one<any>("SELECT event_date FROM token_events WHERE id = ?", [id]);
    if (!existing) throw new Error("Token event not found");
    const today = todayIST();
    // An event whose date is not over yet can never have its date moved
    // into the past — that would fake "the event already happened" and
    // open an escape route around removeEvent's date rule. Future events
    // can be edited and postponed freely, and past-to-past corrections
    // stay allowed. The DB trigger trg_token_events_block_backdate_escape
    // enforces the same rule.
    const upcoming = !existing.event_date || existing.event_date >= today;
    if (upcoming && String(data.eventDate || "") < today) {
      throw new Error("This event's date has not yet passed — its date cannot be moved into the past");
    }
    return run(
      `UPDATE token_events SET event_name = ?, event_type = ?, event_date = ?, event_time = ?, venue = ?, description = ? WHERE id = ?`,
      [data.eventName, data.eventType || "general", data.eventDate, data.eventTime || "", data.venue || "", data.description || "", id]
    );
  },
  // ===== Delete event — ONLY after its date is over =====
  // A token event whose date has passed is a spent record: there is no
  // need to keep it, and an Administrator may delete it (reason required,
  // audit row written in the SAME transaction as the cascade delete).
  // Until the date is over this method refuses, and the DB triggers (see
  // token-guard.ts) block the delete even for a tampered renderer or an
  // external editor — the same rule is mirrored in security-ipc.ts.
  removeEvent: (id: number, reason: string, actor: { id: number; username: string }) => {
    const db = getDB();
    const ev = one<any>("SELECT id, event_name, event_date FROM token_events WHERE id = ?", [id]);
    if (!ev) throw new Error("Token event not found");
    const today = todayIST();
    if (!ev.event_date || ev.event_date >= today) {
      throw new Error("This event's date has not yet passed — it can be deleted only after the event is over");
    }
    if (!String(reason || "").trim()) throw new Error("A deletion reason is required");
    const tokenCount = scalar<number>("SELECT COUNT(*) AS v FROM token_assignments WHERE event_id = ?", [id]);
    db.transaction(() => {
      // Delete the tokens explicitly BEFORE the event row: the FK ON DELETE
      // CASCADE would also do it (foreign_keys is re-asserted ON by getDB),
      // but an explicit delete keeps this audited flow correct under any
      // pragma state. The event's date is over, so the upcoming-event
      // triggers allow both deletes through.
      db.prepare("DELETE FROM token_assignments WHERE event_id = ?").run(id);
      db.prepare("DELETE FROM token_events WHERE id = ?").run(id);
      audit.log(
        actor.id, actor.username, "DELETE", "token_events", id,
        `Token event '${ev.event_name}' deleted (with ${tokenCount} token${tokenCount === 1 ? "" : "s"}): ${String(reason).trim()}`,
        String(reason).trim()
      );
    })();
    return { success: true, deletedTokens: tokenCount };
  },

  // ===== Token listing =====
  list: (filter: { eventId?: number; search?: string; status?: string } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.eventId) {
      where.push("ta.event_id = ?");
      params.push(filter.eventId);
    }
    if (filter.status && filter.status !== "All") {
      where.push("ta.status = ?");
      params.push(filter.status);
    }
    if (filter.search) {
      where.push("(ta.token_code LIKE ? OR f.house_name LIKE ? OR f.family_number LIKE ? OR f.ward LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t, t, t);
    }
    const sql = `SELECT ta.*, f.family_number, f.house_name, f.ward, f.phone,
      te.event_name, te.event_date, te.venue
      FROM token_assignments ta
      LEFT JOIN families f ON f.id = ta.family_id
      LEFT JOIN token_events te ON te.id = ta.event_id
      WHERE ${where.join(" AND ")}
      ORDER BY ta.id DESC`;
    return { rows: all<any>(sql, params), total: 0 };
  },

  // ===== Duplicate check: which families already have tokens for this event =====
  checkExisting: (eventId: number) => {
    const rows = all<any>(
      "SELECT family_id FROM token_assignments WHERE event_id = ? AND status != 'CANCELLED'",
      [eventId]
    );
    return new Set(rows.map((r: any) => r.family_id));
  },

  // ===== Generate tokens for selected families =====
  generate: (eventId: number, familyIds: number[], userId: number) => {
    // Load only token codes for this event (not globally) to keep the working set small.
    const existingCodes = new Set(
      all<any>("SELECT token_code FROM token_assignments WHERE event_id = ?", [eventId]).map((r: any) => r.token_code)
    );
    const existingFamilyTokens = tokens.checkExisting(eventId);

    let generated = 0;
    let skipped = 0;
    const insertStmt = getDB().prepare(
      `INSERT INTO token_assignments (event_id, family_id, token_code, status)
       VALUES (?, ?, ?, 'GENERATED')`
    );

    const insertMany = getDB().transaction(() => {
      for (const familyId of familyIds) {
        if (existingFamilyTokens.has(familyId)) {
          skipped++;
          continue;
        }
        const code = generateUniqueTokenCode(existingCodes);
        existingCodes.add(code);
        insertStmt.run(eventId, familyId, code);
        generated++;
      }
    });
    insertMany();

    return { generated, skipped, total: familyIds.length };
  },

  // ===== Collect / mark as collected =====
  collect: (tokenId: number, userId: number) =>
    run(
      `UPDATE token_assignments SET status = 'COLLECTED', collected = 1, collected_at = datetime('now'), collected_by = ? WHERE id = ? AND status != 'CANCELLED'`,
      [userId, tokenId]
    ),

  // ===== Cancel token (for lost tokens) =====
  cancel: (tokenId: number, reason: string) =>
    run(
      `UPDATE token_assignments SET status = 'CANCELLED', cancelled_at = datetime('now'), cancelled_reason = ? WHERE id = ?`,
      [reason, tokenId]
    ),

  // ===== Replace token (generate new code for cancelled token) =====
  replace: (tokenId: number, reason: string, userId: number) => {
    const db = getDB();
    return db.transaction(() => {
      const oldToken = one<any>("SELECT * FROM token_assignments WHERE id = ?", [tokenId]);
      if (!oldToken) throw new Error("Token not found");

      // Cancel old token
      db.prepare(
        `UPDATE token_assignments SET status = 'CANCELLED', cancelled_at = datetime('now'), cancelled_reason = ? WHERE id = ?`
      ).run(reason, tokenId);

      // Generate new token for same event+family.
      // Scope the duplicate-code check to this event so we don't load the entire table.
      const existingCodes = new Set(
        all<any>("SELECT token_code FROM token_assignments WHERE event_id = ?", [oldToken.event_id]).map((r: any) => r.token_code)
      );
      const newCode = generateUniqueTokenCode(existingCodes);
      const result = db.prepare(
        `INSERT INTO token_assignments (event_id, family_id, token_code, status, replacement_for)
         VALUES (?, ?, ?, 'GENERATED', ?)`
      ).run(oldToken.event_id, oldToken.family_id, newCode, tokenId);
      return { id: Number(result.lastInsertRowid), tokenCode: newCode };
    })();
  },

  // ===== Stats for dashboard =====
  stats: (eventId: number) => {
    const total = scalar<number>("SELECT COUNT(*) AS v FROM token_assignments WHERE event_id = ? AND status != 'CANCELLED'", [eventId]);
    const collected = scalar<number>("SELECT COUNT(*) AS v FROM token_assignments WHERE event_id = ? AND status = 'COLLECTED'", [eventId]);
    const remaining = total - collected;
    const rate = total > 0 ? Math.round((collected / total) * 1000) / 10 : 0;
    return { total, collected, remaining, rate };
  },

  // ===== Get all tokens for an event (for PDF) =====
  listForPdf: (eventId: number) => all<any>(
    `SELECT ta.token_code, ta.status, ta.collected_at, ta.created_at,
       f.family_number, f.house_name, f.ward, f.house_number, f.phone, f.area,
       (SELECT m.name FROM members m WHERE m.family_id = f.id AND m.is_head = 1
          ORDER BY (m.status = 'Active') DESC, m.id LIMIT 1) AS house_head_name,
       te.event_name, te.event_date, te.venue, te.event_time
     FROM token_assignments ta
     LEFT JOIN families f ON f.id = ta.family_id
     LEFT JOIN token_events te ON te.id = ta.event_id
     WHERE ta.event_id = ? AND ta.status != 'CANCELLED'
     ORDER BY f.area, f.ward, f.family_number`,
    [eventId]
  ),
};
