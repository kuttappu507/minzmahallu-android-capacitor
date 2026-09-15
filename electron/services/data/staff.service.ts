/* Staff module — split out of data.service.ts (public API unchanged via the facade). */

import { all, one, run, scalar } from "../../db/connection.js";
import { nowDate } from "./shared.js";

export const staff = {
  list: (filter: { search?: string; role?: string; status?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.search) {
      where.push("(s.name LIKE ? OR s.staff_code LIKE ? OR s.phone LIKE ? OR s.email LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t, t, t);
    }
    if (filter.role && filter.role !== "All") {
      where.push("s.role = ?");
      params.push(filter.role);
    }
    if (filter.status && filter.status !== "All") {
      // "Active" / "Inactive" / "Resigned" / "Archived"
      if (filter.status === "Archived") {
        where.push("s.archive_state = 1");
      } else {
        where.push("s.archive_state = 0 AND s.status = ?");
        params.push(filter.status);
      }
    } else {
      // By default, exclude archived rows unless explicitly requested.
      where.push("s.archive_state = 0");
    }
    const sql = `SELECT s.*, m.member_code AS linked_member_code, m.name AS linked_member_name, m.mobile AS linked_member_mobile
      FROM staff s LEFT JOIN members m ON m.id = s.member_id
      WHERE ${where.join(" AND ")}
      ORDER BY s.staff_code ASC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM staff s WHERE ${where.join(" AND ")}`, params);
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  get: (id: number) => one<any>("SELECT s.*, m.member_code AS linked_member_code, m.name AS linked_member_name FROM staff s LEFT JOIN members m ON m.id = s.member_id WHERE s.id = ?", [id]),
  // EMPLOYEES only — President / Vice President / Secretary / Treasurer /
  // Committee Member are committee positions (they live on the Committee
  // page, committee.service.positions) and must NOT appear as staff roles.
  roles: () => ["Imam", "Khatheeb", "Muazzin", "Khadim", "Madrasa Teacher", "Accountant", "Cleaner", "Security", "Other"],
  create: (data: any) => {
    const num = scalar<string>(
      "SELECT 'STF-' || printf('%04d', COALESCE(MAX(id), 0) + 1) AS n FROM staff"
    );
    const { id } = run(
      `INSERT INTO staff
        (staff_code, member_id, name, role, phone, email, address, joined_date, salary, payment_frequency, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        num,
        data.memberId ?? null,
        data.name ?? "",
        data.role ?? "Staff",
        data.phone ?? "",
        data.email ?? "",
        data.address ?? "",
        data.joinedDate ?? null,
        Number(data.salary ?? 0),
        data.paymentFrequency ?? "Monthly",
        data.status ?? "Active",
        data.notes ?? ""
      ]
    );
    return { id, staffCode: num };
  },
  update: (id: number, data: any) =>
    run(
      `UPDATE staff SET member_id = ?, name = ?, role = ?, phone = ?, email = ?, address = ?, joined_date = ?, salary = ?, payment_frequency = ?, status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.memberId ?? null,
        data.name ?? "",
        data.role ?? "Staff",
        data.phone ?? "",
        data.email ?? "",
        data.address ?? "",
        data.joinedDate ?? null,
        Number(data.salary ?? 0),
        data.paymentFrequency ?? "Monthly",
        data.status ?? "Active",
        data.notes ?? "",
        id
      ]
    ),
  archive: (id: number, reason: string, userId: number) =>
    run(
      `UPDATE staff SET archive_state = 1, archive_source = 'manual', archived_at = datetime('now'), archived_by = ?, archive_reason = ?, status = 'Resigned', updated_at = datetime('now') WHERE id = ?`,
      [userId, reason, id]
    ),
  /** Resignation / expulsion of a staff member (secure action — reason and
   *  administrator password are verified at the IPC layer). The effective
   *  date and reason are preserved on the record; archived_at carries the
   *  effective date so reports can show when the service ended. */
  setStatus: (id: number, status: "Resigned" | "Expelled", effectiveDate: string, reason: string, userId: number) => {
    if (status !== "Resigned" && status !== "Expelled") {
      throw new Error("Staff status can only be set to Resigned or Expelled through this action");
    }
    const s = one<any>("SELECT id, name, staff_code, status, archive_state FROM staff WHERE id = ?", [id]);
    if (!s) throw new Error("Staff member not found");
    if (s.archive_state) throw new Error("This staff member has already left service. Restore the record first if the status needs correcting.");
    if (!reason?.trim()) throw new Error("A reason is required");
    const eff = effectiveDate || nowDate();
    return run(
      `UPDATE staff SET archive_state = 1, archive_source = 'manual', archived_at = ?, archived_by = ?, archive_reason = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
      [eff, userId, reason.trim(), status, id]
    );
  },
  restore: (id: number, userId: number) =>
    run(
      `UPDATE staff SET archive_state = 0, archive_source = NULL, archived_at = NULL, archived_by = ?, archive_reason = NULL, status = 'Active', updated_at = datetime('now') WHERE id = ?`,
      [userId, id]
    ),
  // ===== Salary payments =====
  listPayments: (filter: { staffId?: number; year?: number; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.staffId) {
      where.push("sp.staff_id = ?");
      params.push(filter.staffId);
    }
    if (filter.year) {
      where.push("sp.period_year = ?");
      params.push(filter.year);
    }
    const sql = `SELECT sp.*, s.staff_code, s.name AS staff_name, s.role AS staff_role
      FROM staff_payments sp LEFT JOIN staff s ON s.id = sp.staff_id
      WHERE ${where.join(" AND ")}
      ORDER BY sp.period_year DESC, sp.period_month DESC, sp.id DESC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM staff_payments sp WHERE ${where.join(" AND ")}`, params);
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  paySalary: (data: any, userId: number) => {
    const { id } = run(
      `INSERT INTO staff_payments (staff_id, period_month, period_year, amount, payment_date, payment_method, transaction_ref, status, notes, paid_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.staffId,
        Number(data.periodMonth),
        Number(data.periodYear),
        Number(data.amount ?? 0),
        data.paymentDate || nowDate(),
        data.paymentMethod || "Cash",
        data.transactionRef || "",
        data.status || "Paid",
        data.notes || "",
        userId
      ]
    );
    return { id };
  },
  cancelPayment: (id: number) =>
    run(`UPDATE staff_payments SET status = 'Cancelled' WHERE id = ?`, [id]),
  salarySummary: (year: number = new Date().getFullYear()) => {
    const row = one<any>(
      `SELECT
        COALESCE(SUM(CASE WHEN status='Paid' THEN amount ELSE 0 END), 0) AS total_paid,
        COALESCE(SUM(CASE WHEN status='Pending' THEN amount ELSE 0 END), 0) AS total_pending,
        COUNT(CASE WHEN status='Paid' THEN 1 END) AS paid_count,
        COUNT(CASE WHEN status='Pending' THEN 1 END) AS pending_count
       FROM staff_payments WHERE period_year = ?`,
      [year]
    );
    const activeCount = scalar<number>("SELECT COUNT(*) AS v FROM staff WHERE archive_state = 0 AND status = 'Active'", []);
    return {
      totalPaid: row?.total_paid ?? 0,
      totalPending: row?.total_pending ?? 0,
      paidCount: row?.paid_count ?? 0,
      pendingCount: row?.pending_count ?? 0,
      activeStaffCount: activeCount,
      year
    };
  },
  history: (staffId: number, limit = 100) =>
    all<any>(
      `SELECT * FROM record_history WHERE entity_type = ? AND entity_id = ? ORDER BY changed_at DESC, id DESC LIMIT ?`,
      ["staff", staffId, limit]
    ),
};
