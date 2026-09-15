import { getDB, all } from "../db/connection.js";

export type Actor = { id: number; username: string; role: string };

function requireActor(actor: Actor) {
  if (!actor?.id || !actor.username) throw new Error("Authentication is required for this operation");
}
function requireAdmin(actor: Actor) {
  requireActor(actor);
  if (actor.role !== "Administrator") throw new Error("Administrator permission is required for this operation");
}
function history(actor: Actor, entityType: string, entityId: number, action: string, summary: string, changes: Record<string, unknown> = {}, reason = "") {
  getDB().prepare(`INSERT INTO record_history (entity_type, entity_id, action, user_id, username, summary, changes_json, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(entityType, entityId, action, actor.id, actor.username, summary, JSON.stringify(changes), reason);
}
function changedFields(before: any, after: any, fields: string[]) {
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of fields) if ((before?.[field] ?? null) !== (after?.[field] ?? null)) changes[field] = { old: before?.[field] ?? null, new: after?.[field] ?? null };
  return changes;
}

export const security = {
  updateFamily(actor: Actor, familyId: number, data: any) {
    requireActor(actor);
    const db = getDB();
    const before = db.prepare("SELECT * FROM families WHERE id=?").get(familyId) as any;
    if (!before) throw new Error("Family not found");
    if (before.status === "Archived") throw new Error("Archived families cannot be edited; restore the family first");
    // WhatsApp fields MUST be written here too: the family edit dialog saves
    // through this audited path (families:update), and omitting them silently
    // discarded any number the user added while editing (real bug report).
    db.prepare(`UPDATE families SET house_name=?, house_number=?, ward=?, area=?, address=?, pincode=?, phone=?, alternative_phone=?, status=?, notes=?, whatsapp_phone=?, whatsapp_enabled=?, updated_at=datetime('now') WHERE id=?`).run(data.houseName ?? "", data.houseNumber ?? "", data.ward ?? "", data.area ?? "", data.address ?? "", data.pincode ?? "", data.phone ?? "", data.altPhone ?? "", "Active", data.notes ?? "", data.whatsappPhone ?? "", data.whatsappEnabled === 0 ? 0 : 1, familyId);
    const after = db.prepare("SELECT * FROM families WHERE id=?").get(familyId) as any;
    const changes = changedFields(before, after, ["house_name","house_number","ward","area","address","pincode","phone","alternative_phone","notes","whatsapp_phone","whatsapp_enabled"]);
    if (Object.keys(changes).length) history(actor, "family", familyId, "EDIT", "Family details updated", changes);
    return { id: familyId, changes };
  },

  updateMember(actor: Actor, memberId: number, data: any) {
    requireActor(actor);
    const db = getDB();
    const before = db.prepare("SELECT * FROM members WHERE id=?").get(memberId) as any;
    if (!before) throw new Error("Member not found");
    if (before.archive_state) throw new Error("Archived members cannot be edited; restore the member first");
    if (Number(data.familyId) !== Number(before.family_id)) {
      throw new Error("Family changes must use the audited member move operation");
    }
    // Single-head rule: only enforced when THIS member is being made the head.
    if (data.relationship === "Head" && !(before.is_head === 1 || before.relationship === "Head")) {
      const existingHead = db.prepare(
        "SELECT id, name FROM members WHERE family_id = ? AND archive_state = 0 AND (is_head = 1 OR relationship = 'Head') AND id != ? LIMIT 1"
      ).get(before.family_id, memberId) as any;
      if (existingHead) {
        throw new Error(
          `This family already has a head (${existingHead.name || "member #" + existingHead.id}). ` +
          "A family can have only one head — change the existing head's relationship first."
        );
      }
    }
    db.prepare(`UPDATE members SET family_id=?, name=?, arabic_name=?, gender=?, date_of_birth=?, age=?, blood_group=?, occupation=?, education=?, marital_status=?, mobile=?, email=?, emergency_contact=?, relationship=?, is_head=?, status=?, nationality=?, address=?, father_id=?, mother_id=?, spouse_id=?, updated_at=datetime('now') WHERE id=?`).run(before.family_id, data.name, data.arabicName ?? "", data.gender, data.dateOfBirth, data.age, data.bloodGroup, data.occupation, data.education, data.maritalStatus, data.mobile, data.email, data.emergencyContact, data.relationship, data.relationship === "Head" ? 1 : 0, data.status, data.nationality, data.address, data.fatherId ?? null, data.motherId ?? null, data.spouseId ?? null, memberId);
    const after = db.prepare("SELECT * FROM members WHERE id=?").get(memberId) as any;
    const changes = changedFields(before, after, ["name","arabic_name","gender","date_of_birth","age","blood_group","occupation","education","marital_status","mobile","email","emergency_contact","relationship","status","nationality","address","father_id","mother_id","spouse_id"]);
    if (Object.keys(changes).length) history(actor, "member", memberId, "EDIT", "Member details updated", changes);
    return { id: memberId, changes };
  },

  archiveFamily(actor: Actor, familyId: number, reason: string) {
    requireAdmin(actor);
    if (!reason?.trim()) throw new Error("An archive reason is required");
    const db = getDB();
    const tx = db.transaction(() => {
      const family = db.prepare("SELECT * FROM families WHERE id=?").get(familyId) as any;
      if (!family) throw new Error("Family not found");
      if (family.status === "Archived") return { id: familyId, alreadyArchived: true, membersArchived: 0 };
      const members = db.prepare("SELECT id, archive_state FROM members WHERE family_id=? AND archive_state=0").all(familyId) as any[];
      db.prepare(`UPDATE families SET status='Archived', archived_at=datetime('now'), archived_by=?, archive_reason=?, updated_at=datetime('now') WHERE id=?`).run(actor.id, reason.trim(), familyId);
      db.prepare(`UPDATE members SET archive_state=1, archive_source='family', archived_at=datetime('now'), archived_by=?, archive_reason=?, updated_at=datetime('now') WHERE family_id=? AND archive_state=0`).run(actor.id, reason.trim(), familyId);
      history(actor, "family", familyId, "ARCHIVE", "Family archived", { previousStatus: family.status, newStatus: "Archived", membersArchived: members.length }, reason.trim());
      for (const m of members) history(actor, "member", m.id, "ARCHIVE", "Member archived with family", { archiveSource: "family", familyId }, reason.trim());
      return { id: familyId, alreadyArchived: false, membersArchived: members.length };
    });
    return tx();
  },

  restoreFamily(actor: Actor, familyId: number, reason = "") {
    requireAdmin(actor);
    const db = getDB();
    const tx = db.transaction(() => {
      const family = db.prepare("SELECT * FROM families WHERE id=?").get(familyId) as any;
      if (!family) throw new Error("Family not found");
      if (family.status !== "Archived") return { id: familyId, alreadyActive: true, membersRestored: 0 };
      const members = db.prepare("SELECT id FROM members WHERE family_id=? AND archive_state=1 AND archive_source='family'").all(familyId) as any[];
      db.prepare(`UPDATE families SET status='Active', archived_at=NULL, archived_by=NULL, archive_reason=NULL, updated_at=datetime('now') WHERE id=?`).run(familyId);
      db.prepare(`UPDATE members SET archive_state=0, archive_source=NULL, archived_at=NULL, archived_by=NULL, archive_reason=NULL, updated_at=datetime('now') WHERE family_id=? AND archive_state=1 AND archive_source='family'`).run(familyId);
      history(actor, "family", familyId, "RESTORE", "Family restored", { previousStatus: "Archived", newStatus: "Active", membersRestored: members.length }, reason.trim());
      for (const m of members) history(actor, "member", m.id, "RESTORE", "Member restored with family", { restoreSource: "family", familyId }, reason.trim());
      return { id: familyId, alreadyActive: false, membersRestored: members.length };
    });
    return tx();
  },

  archiveMember(actor: Actor, memberId: number, reason: string) {
    requireAdmin(actor);
    if (!reason?.trim()) throw new Error("An archive reason is required");
    const db = getDB();
    const tx = db.transaction(() => {
      const member = db.prepare("SELECT * FROM members WHERE id=?").get(memberId) as any;
      if (!member) throw new Error("Member not found");
      if (member.archive_state) return { id: memberId, alreadyArchived: true };
      db.prepare(`UPDATE members SET archive_state=1, archive_source='manual', archived_at=datetime('now'), archived_by=?, archive_reason=?, updated_at=datetime('now') WHERE id=?`).run(actor.id, reason.trim(), memberId);
      history(actor, "member", memberId, "ARCHIVE", "Member archived", { archiveSource: "manual", familyId: member.family_id }, reason.trim());
      return { id: memberId, alreadyArchived: false };
    });
    return tx();
  },

  restoreMember(actor: Actor, memberId: number, reason = "") {
    requireAdmin(actor);
    const db = getDB();
    const tx = db.transaction(() => {
      const member = db.prepare("SELECT * FROM members WHERE id=?").get(memberId) as any;
      if (!member) throw new Error("Member not found");
      if (!member.archive_state) return { id: memberId, alreadyActive: true };
      if (member.archive_source === "family") throw new Error("This member was archived with the family. Restore the family instead.");
      const source = member.archive_source;
      db.prepare(`UPDATE members SET archive_state=0, archive_source=NULL, archived_at=NULL, archived_by=NULL, archive_reason=NULL, updated_at=datetime('now') WHERE id=?`).run(memberId);
      history(actor, "member", memberId, "RESTORE", "Member restored", { previousArchiveSource: source }, reason.trim());
      return { id: memberId, alreadyActive: false };
    });
    return tx();
  },

  moveMembers(actor: Actor, memberIds: number[], newFamilyId: number, reason: string, moveType: "ExistingFamily" | "NewFamily" = "ExistingFamily") {
    requireAdmin(actor);
    if (!memberIds.length) throw new Error("Select at least one member");
    if (!reason?.trim()) throw new Error("A move reason is required");
    const db = getDB();
    const tx = db.transaction(() => {
      const family = db.prepare("SELECT id, status FROM families WHERE id=?").get(newFamilyId) as any;
      if (!family) throw new Error("Destination family not found");
      if (family.status === "Archived") throw new Error("Cannot move members into an archived family");
      let moved = 0;
      for (const memberId of [...new Set(memberIds)]) {
        const member = db.prepare("SELECT id, family_id, name, relationship, is_head, archive_state FROM members WHERE id=?").get(memberId) as any;
        if (!member) throw new Error(`Member ${memberId} not found`);
        if (member.archive_state) throw new Error(`Member ${member.name || member.id} is archived. Restore the member before moving it.`);
        if (member.family_id === newFamilyId) continue;
        // Single-head rule: a member who is the head of their OLD family cannot
        // stay head in the destination family if that family already has one.
        const isHeadLike = member.is_head === 1 || member.relationship === "Head";
        const destHasHead = db.prepare(
          "SELECT id FROM members WHERE family_id = ? AND archive_state = 0 AND (is_head = 1 OR relationship = 'Head') AND id != ? LIMIT 1"
        ).get(newFamilyId, member.id) as any;
        const demoted = isHeadLike && !!destHasHead;
        db.prepare("INSERT INTO family_moves (member_id, old_family_id, new_family_id, move_type, reason, moved_by) VALUES (?, ?, ?, ?, ?, ?)").run(member.id, member.family_id, newFamilyId, moveType, reason.trim(), actor.id);
        db.prepare(demoted
          ? "UPDATE members SET family_id=?, relationship='Other', is_head=0, updated_at=datetime('now') WHERE id=?"
          : "UPDATE members SET family_id=?, updated_at=datetime('now') WHERE id=?").run(newFamilyId, member.id);
        history(actor, "member", member.id, "FAMILY_MOVE",
          demoted ? `Member moved to family ${newFamilyId} (demoted from Head — destination family already has a head)` : `Member moved to family ${newFamilyId}`,
          { oldFamilyId: member.family_id, newFamilyId, memberName: member.name, demotedFromHead: demoted }, reason.trim());
        moved++;
      }
      return { moved, familyId: newFamilyId };
    });
    return tx();
  },

  createFamilyFromMembers(actor: Actor, memberIds: number[], familyData: any, headMemberId: number, reason: string) {
    requireAdmin(actor);
    if (!memberIds.length) throw new Error("Select at least one member");
    if (!memberIds.includes(headMemberId)) throw new Error("The new head must be one of the selected members");
    if (!reason?.trim()) throw new Error("A move reason is required");
    const db = getDB();
    const tx = db.transaction(() => {
      const familyNumber = db.prepare("SELECT 'FAM-' || printf('%04d', COALESCE(MAX(id),0)+1) AS n FROM families").get() as any;
      const result = db.prepare(`INSERT INTO families (family_number, house_name, house_number, ward, area, address, pincode, phone, alternative_phone, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?)`).run(familyNumber.n, familyData.houseName ?? "", familyData.houseNumber ?? "", familyData.ward ?? "", familyData.area ?? "", familyData.address ?? "", familyData.pincode ?? "", familyData.phone ?? "", familyData.altPhone ?? "", familyData.notes ?? "");
      const newFamilyId = Number(result.lastInsertRowid);
      history(actor, "family", newFamilyId, "CREATE_FROM_MEMBERS", "New family created from existing members", { memberIds, headMemberId, familyNumber: familyNumber.n }, reason.trim());
      for (const memberId of [...new Set(memberIds)]) {
        const member = db.prepare("SELECT id, family_id, name, archive_state FROM members WHERE id=?").get(memberId) as any;
        if (!member) throw new Error(`Member ${memberId} not found`);
        if (member.archive_state) throw new Error(`Member ${member.name || member.id} is archived. Restore the member before creating a new family.`);
        db.prepare("INSERT INTO family_moves (member_id, old_family_id, new_family_id, move_type, reason, moved_by) VALUES (?, ?, ?, 'NewFamily', ?, ?)").run(memberId, member.family_id, newFamilyId, reason.trim(), actor.id);
        db.prepare("UPDATE members SET family_id=?, relationship=?, updated_at=datetime('now') WHERE id=?").run(newFamilyId, memberId === headMemberId ? "Head" : "Other", memberId);
        history(actor, "member", memberId, "FAMILY_MOVE", `Member moved to new family ${newFamilyId}`, { oldFamilyId: member.family_id, newFamilyId, newRelationship: memberId === headMemberId ? "Head" : "Other", memberName: member.name }, reason.trim());
      }
      return { id: newFamilyId, familyNumber: familyNumber.n, moved: memberIds.length };
    });
    return tx();
  },

  history(entityType: string, entityId: number, limit = 100) {
    return all<any>(`SELECT * FROM record_history WHERE entity_type=? AND entity_id=? ORDER BY changed_at DESC, id DESC LIMIT ?`, [entityType, entityId, limit]);
  },
  /**
   * Public writer for the per-record change history (record_history table).
   * Used by the secured IPC layer to record BEFORE→AFTER diffs of sensitive
   * edits (e.g. ledger entry edits) so the double-click preview in the UI can
   * show exactly what changed, who changed it and why. The tamper-evident
   * audit_log chain keeps its own row in parallel — the two are complementary:
   * record_history holds structured field diffs, audit_log holds the chain.
   */
  logChange(actor: Actor, entityType: string, entityId: number, action: string, summary: string, changes: Record<string, unknown> = {}, reason = "") {
    requireActor(actor);
    history(actor, entityType, entityId, action, summary, changes, reason);
  },
  familyMoveHistory(memberId: number) {
    return all<any>(`SELECT fm.*, of.family_number AS old_family_number, nf.family_number AS new_family_number, u.username AS moved_by_username FROM family_moves fm LEFT JOIN families of ON of.id=fm.old_family_id LEFT JOIN families nf ON nf.id=fm.new_family_id LEFT JOIN users u ON u.id=fm.moved_by WHERE fm.member_id=? ORDER BY fm.moved_at DESC`, [memberId]);
  },
};
