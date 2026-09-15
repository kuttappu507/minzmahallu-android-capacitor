/* Marriage module — split out of data.service.ts (public API unchanged via the facade). */

import { all, one, run } from "../../db/connection.js";
import { nextRegisterNumber, nowDate } from "./shared.js";

export const marriages = {
  list: (filter: { search?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.search) {
      where.push("(m.marriage_number LIKE ? OR m.bride_name LIKE ? OR m.groom_name LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t, t);
    }
    const sql = `SELECT m.* FROM marriages m WHERE ${where.join(" AND ")} ORDER BY m.nikah_date DESC, m.id DESC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM marriages m WHERE ${where.join(" AND ")}`, params);
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  get: (id: number) => one<any>("SELECT * FROM marriages WHERE id = ?", [id]),
  create: (data: any) => {
    // Robust numbering: MAX trailing suffix + 1 across ALL marriages (see
    // nextRegisterNumber) — COUNT-based numbers collided/lagged when a
    // nikah_date fell outside the current year.
    const num = nextRegisterNumber("marriages", "marriage_number", "MRG");
    const { id } = run(
      `INSERT INTO marriages
        (marriage_number, bride_name, bride_father, bride_address, groom_name, groom_father, groom_address, witness1, witness2, witness3, witness4, mahar, nikah_date, registration_date, place, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        num, data.brideName ?? "", data.brideFather ?? "", data.brideAddress ?? "",
        data.groomName ?? "", data.groomFather ?? "", data.groomAddress ?? "",
        data.witness1 ?? "", data.witness2 ?? "", data.witness3 ?? "", data.witness4 ?? "",
        data.mahar ?? "", data.nikahDate, data.registrationDate || nowDate(),
        data.place ?? "", data.remarks ?? ""
      ]
    );
    return { id, marriageNumber: num };
  },
  update: (id: number, data: any) =>
    run(
      `UPDATE marriages SET bride_name = ?, bride_father = ?, bride_address = ?, groom_name = ?, groom_father = ?, groom_address = ?, witness1 = ?, witness2 = ?, witness3 = ?, witness4 = ?, mahar = ?, nikah_date = ?, registration_date = ?, place = ?, remarks = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.brideName ?? "", data.brideFather ?? "", data.brideAddress ?? "",
        data.groomName ?? "", data.groomFather ?? "", data.groomAddress ?? "",
        data.witness1 ?? "", data.witness2 ?? "", data.witness3 ?? "", data.witness4 ?? "",
        data.mahar ?? "", data.nikahDate ?? "", data.registrationDate ?? nowDate(),
        data.place ?? "", data.remarks ?? "", id
      ]
    ),
  remove: (id: number) => run("DELETE FROM marriages WHERE id = ?", [id]),
  // Raw rows for the printed marriage register (chronological, numbered).
  registerRows: () => all<any>(
    `SELECT id, marriage_number, nikah_date, bride_name, bride_father, groom_name, groom_father, place, mahar
     FROM marriages ORDER BY nikah_date ASC, id ASC`
  ),
};
