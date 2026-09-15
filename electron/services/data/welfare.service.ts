/* Welfare module — split out of data.service.ts (public API unchanged via the facade). */

import { all, one, run } from "../../db/connection.js";
import { nextRegisterNumber, nowDate } from "./shared.js";

export const welfare = {
  list: (filter: { search?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.search) {
      where.push("(w.request_number LIKE ? OR w.applicant_name LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t);
    }
    if (filter.status && filter.status !== "All") {
      where.push("w.status = ?");
      params.push(filter.status);
    }
    const sql = `SELECT w.* FROM welfare_requests w WHERE ${where.join(" AND ")} ORDER BY w.request_date DESC, w.id DESC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM welfare_requests w WHERE ${where.join(" AND ")}`, params);
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  get: (id: number) => one<any>("SELECT * FROM welfare_requests WHERE id = ?", [id]),
  create: (data: any) => {
    // MAX(id)+1 could reuse a number after deleting the newest request;
    // use the same suffix-max scheme as the other official registers
    // (WEL keeps its legacy 4-digit, year-less format).
    const num = nextRegisterNumber("welfare_requests", "request_number", "WEL", { pad: 4, withYear: false });
    const { id } = run(
      `INSERT INTO welfare_requests
        (request_number, applicant_name, family_id, category, amount_requested, amount_approved, reason, request_date, status, remarks, processed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        num, data.applicantName, data.familyId ?? null,
        data.category ?? "", data.amountRequested, data.amountApproved ?? 0,
        data.reason ?? "", nowDate(), "Pending",
        data.remarks ?? "", data.processedBy ?? 1
      ]
    );
    return { id, requestNumber: num };
  },
  update: (id: number, data: any) =>
    run(
      `UPDATE welfare_requests SET applicant_name = ?, family_id = ?, category = ?, amount_requested = ?, amount_approved = ?, reason = ?, remarks = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.applicantName, data.familyId, data.category,
        data.amountRequested, data.amountApproved, data.reason,
        data.remarks, id
      ]
    ),
  approve: (id: number, amount: number, remarks: string, userId: number, minutesDate?: string) =>
    run(
      `UPDATE welfare_requests SET status = 'Approved', amount_approved = ?, remarks = ?, minutes_date = COALESCE(?, minutes_date), processed_by = ?, processed_date = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [amount, remarks, minutesDate || null, userId, id]
    ),
  reject: (id: number, reason: string, userId: number) =>
    run(
      `UPDATE welfare_requests SET status = 'Rejected', remarks = ?, processed_by = ?, processed_date = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [reason, userId, id]
    ),
  /** Disbursement is a secure action: the IPC layer verifies the administrator
   *  password and requires a reason before calling this. A minutes_date must
   *  exist (recorded at approval) — the foolproof workflow trail. */
  disburse: (id: number, userId: number, reason = "") => {
    const w = one<any>("SELECT id, minutes_date, amount_approved FROM welfare_requests WHERE id = ?", [id]);
    if (!w) throw new Error("Welfare request not found");
    if (!w.minutes_date) {
      throw new Error("Date of the committee minutes approving this amount is missing. Reject the request and re-approve it with the minutes date recorded.");
    }
    return run(
      `UPDATE welfare_requests SET status = 'Disbursed', disbursed_date = ?, remarks = CASE WHEN ? != '' THEN (CASE WHEN remarks = '' OR remarks IS NULL THEN ? ELSE remarks || ' | Disbursement: ' || ? END) ELSE remarks END, processed_by = ?, updated_at = datetime('now') WHERE id = ?`,
      [nowDate(), reason.trim(), reason.trim(), reason.trim(), userId, id]
    );
  },
  remove: (id: number) => run("DELETE FROM welfare_requests WHERE id = ?", [id]),
  categories: () => ["Medical Aid", "Education Aid", "Marriage Assistance", "Financial Assistance"],
};
