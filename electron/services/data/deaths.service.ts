/* Death module — split out of data.service.ts (public API unchanged via the facade). */

import { all, one, run } from "../../db/connection.js";
import { nextRegisterNumber, nowDate } from "./shared.js";

export const deaths = {
  list: (filter: { search?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.search) {
      where.push("(d.death_number LIKE ? OR d.deceased_name LIKE ? OR d.father_name LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t, t);
    }
    const sql = `SELECT d.* FROM deaths d WHERE ${where.join(" AND ")} ORDER BY d.date_of_death DESC, d.id DESC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(`SELECT COUNT(*) AS c FROM deaths d WHERE ${where.join(" AND ")}`, params);
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  get: (id: number) => one<any>("SELECT * FROM deaths WHERE id = ?", [id]),
  create: (data: any) => {
    // Robust numbering: MAX trailing suffix + 1 across ALL deaths (see
    // nextRegisterNumber) — COUNT-based numbers could be reused after a
    // deletion or lag behind when a death date is backdated.
    const num = nextRegisterNumber("deaths", "death_number", "DTH");
    const { id } = run(
      `INSERT INTO deaths
        (death_number, deceased_name, father_name, gender, age, date_of_death, place_of_death, burial_date, cause_of_death, burial_place, address, family_id, registration_date, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        num, data.deceasedName ?? "", data.fatherName ?? "",
        data.gender ?? "Male", data.age ?? null, data.dateOfDeath,
        data.placeOfDeath ?? "", data.burialDate, data.causeOfDeath ?? "", data.burialPlace ?? "",
        data.address ?? "", data.familyId ?? null,
        data.registrationDate || nowDate(), data.remarks ?? ""
      ]
    );
    return { id, deathNumber: num };
  },
  update: (id: number, data: any) =>
    run(
      `UPDATE deaths SET deceased_name = ?, father_name = ?, gender = ?, age = ?, date_of_death = ?, place_of_death = ?, burial_date = ?, cause_of_death = ?, burial_place = ?, address = ?, family_id = ?, registration_date = ?, remarks = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.deceasedName ?? "", data.fatherName ?? "", data.gender ?? "Male",
        data.age ?? null, data.dateOfDeath ?? "", data.placeOfDeath ?? "",
        data.burialDate ?? "", data.causeOfDeath ?? "", data.burialPlace ?? "",
        data.address ?? "", data.familyId ?? null, data.registrationDate || nowDate(),
        data.remarks ?? "", id
      ]
    ),
  remove: (id: number) => run("DELETE FROM deaths WHERE id = ?", [id]),
  // Raw rows for the printed death register (chronological, numbered).
  registerRows: () => all<any>(
    `SELECT id, death_number, deceased_name, father_name, gender, age, date_of_death, place_of_death, burial_date, burial_place
     FROM deaths ORDER BY date_of_death ASC, id ASC`
  ),
};
