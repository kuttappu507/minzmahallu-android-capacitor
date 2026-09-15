/* Members module — split out of data.service.ts (public API unchanged via the facade). */

import { all, one, run, scalar } from "../../db/connection.js";

export const members = {
  list: (filter: { search?: string; familyId?: number; status?: string; page?: number; pageSize?: number } = {}) => {
    const where: string[] = ["1=1"];
    const params: any[] = [];
    if (filter.search) {
      where.push("(m.name LIKE ? OR m.member_code LIKE ? OR m.mobile LIKE ? OR m.email LIKE ?)");
      const t = `%${filter.search}%`;
      params.push(t, t, t, t);
    }
    if (filter.familyId) {
      where.push("m.family_id = ?");
      params.push(filter.familyId);
    }
    if (filter.status && filter.status !== "All") {
      where.push("m.status = ?");
      params.push(filter.status);
    }
    const sql = `SELECT m.*, f.family_number, f.house_name AS family_house_name
      FROM members m LEFT JOIN families f ON f.id = m.family_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.member_code ASC`;
    if (filter.page && filter.pageSize) {
      const offset = (filter.page - 1) * filter.pageSize;
      const pageSql = `${sql} LIMIT ? OFFSET ?`;
      const rows = all<any>(pageSql, [...params, filter.pageSize, offset]);
      const totalRow = one<{ c: number }>(
        `SELECT COUNT(*) AS c FROM members m WHERE ${where.join(" AND ")}`,
        params
      );
      return { rows, total: totalRow?.c ?? 0 };
    }
    return { rows: all<any>(sql, params), total: 0 };
  },
  get: (id: number) => one<any>("SELECT * FROM members WHERE id = ?", [id]),
  // A family can only have ONE head. When a member is saved with the Head
  // relationship, verify no OTHER member of that family is already the head.
  assertSingleHead: (familyId: number | null | undefined, excludeMemberId?: number) => {
    if (!familyId) return;
    const existing = one<any>(
      `SELECT id, name FROM members
        WHERE family_id = ? AND archive_state = 0
          AND (is_head = 1 OR relationship = 'Head')
          AND id != ?
        ORDER BY CASE WHEN is_head = 1 THEN 0 ELSE 1 END, id LIMIT 1`,
      [familyId, excludeMemberId ?? -1]
    );
    if (existing) {
      throw new Error(
        `This family already has a head (${existing.name || "member #" + existing.id}). ` +
        "A family can have only one head — change the existing head's relationship first."
      );
    }
  },
  create: (data: any) => {
    // Single-head rule applies ONLY when this new member is being saved AS the
    // head. Adding a Son/Daughter/Spouse etc. to a family that already has a
    // head is perfectly normal and must NOT be blocked.
    if (data.relationship === "Head") members.assertSingleHead(data.familyId);
    const num = scalar<string>(
      "SELECT 'MBR-' || printf('%04d', COALESCE(MAX(id), 0) + 1) AS n FROM members"
    );
    const isHead = data.relationship === "Head" ? 1 : 0;
    const { id } = run(
      `INSERT INTO members
        (member_code, family_id, name, arabic_name, father_name, gender, date_of_birth, age, blood_group, occupation, education, marital_status, mobile, email, emergency_contact, relationship, is_head, status, nationality, address, father_id, mother_id, spouse_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        num, data.familyId, data.name ?? "", data.arabicName ?? "",
        data.fatherName ?? "", data.gender ?? "Male", data.dateOfBirth ?? "", data.age ?? null,
        data.bloodGroup ?? "", data.occupation ?? "", data.education ?? "",
        data.maritalStatus ?? "Single", data.mobile ?? "",
        data.email ?? "", data.emergencyContact ?? "",
        data.relationship ?? "Other", isHead,
        data.status ?? "Active",
        data.nationality ?? "Indian", data.address ?? "",
        data.fatherId ?? null, data.motherId ?? null, data.spouseId ?? null
      ]
    );
    return { id, memberCode: num };
  },
  update: (id: number, data: any) => {
    if (data.relationship === "Head") members.assertSingleHead(data.familyId, id);
    return run(
      `UPDATE members SET family_id = ?, name = ?, arabic_name = ?, father_name = ?, gender = ?, date_of_birth = ?, age = ?, blood_group = ?, occupation = ?, education = ?, marital_status = ?, mobile = ?, email = ?, emergency_contact = ?, relationship = ?, is_head = ?, status = ?, nationality = ?, address = ?, father_id = ?, mother_id = ?, spouse_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.familyId, data.name ?? "", data.arabicName ?? "", data.fatherName ?? "",
        data.gender ?? "Male", data.dateOfBirth ?? "", data.age ?? null, data.bloodGroup ?? "",
        data.occupation ?? "", data.education ?? "", data.maritalStatus ?? "Single",
        data.mobile ?? "", data.email ?? "", data.emergencyContact ?? "",
        data.relationship ?? "Other", data.relationship === "Head" ? 1 : 0,
        data.status ?? "Active", data.nationality ?? "Indian",
        data.address ?? "",
        data.fatherId ?? null, data.motherId ?? null, data.spouseId ?? null,
        id
      ]
    );
  },
  remove: (id: number) => run("DELETE FROM members WHERE id = ?", [id]),
  /**
   * Family-tree relations for a member: father, mother, spouse (direct member
   * links) and children (members whose father_id or mother_id points here).
   */
  relations: (id: number) => {
    const member = one<any>("SELECT id FROM members WHERE id = ?", [id]);
    if (!member) return null;
    const pick = (ids: (number | null)[]): any[] => {
      const clean = [...new Set(ids.filter((x): x is number => !!x && Number.isFinite(x)))];
      if (!clean.length) return [];
      return all<any>(
        `SELECT id, member_code, name, gender, relationship, is_head, mobile, date_of_birth, status, archive_state
         FROM members WHERE id IN (${clean.map(() => "?").join(",")}) AND archive_state = 0`,
        clean
      );
    };
    const self = one<any>("SELECT father_id, mother_id, spouse_id FROM members WHERE id = ?", [id]);
    const links = pick([self?.father_id, self?.mother_id, self?.spouse_id]);
    const byId = (v: any) => links.find((l) => l.id === v) || null;
    const children = all<any>(
      `SELECT id, member_code, name, gender, date_of_birth, status
       FROM members
       WHERE (father_id = ? OR mother_id = ?) AND archive_state = 0 AND id != ?
       ORDER BY date_of_birth ASC, id ASC`,
      [id, id, id]
    );
    return {
      father: byId(self?.father_id),
      mother: byId(self?.mother_id),
      spouse: byId(self?.spouse_id),
      children,
    };
  },
  relationships: () => [
    "Head", "Spouse", "Son", "Daughter", "Parent",
    "Brother", "Sister", "Nephew", "Niece",
    "Grandfather", "Grandmother", "Grandson", "Granddaughter",
    "Father-in-law", "Mother-in-law", "Other",
  ],
};
