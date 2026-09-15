/* Shared test fixtures.
 *
 * The old V032 demo migration (wiped real data and loaded a demo dataset on
 * every fresh install) was retired for security reasons, so fresh test
 * databases now start EMPTY just like a real first-run install. Tests that
 * reference families/subscriptions must therefore create their own rows.
 * These helpers are idempotent: they create the row only when missing, so
 * test files stay independent of execution order (fileParallelism: false,
 * one shared per-PID database).
 */
import { getDB } from "../db/connection.js";
import { families, members, deaths, marriages } from "./data.service.js";
import { subscriptions } from "./data/subscriptions.service.js";

/** Ensure a family exists with the given id on a fresh DB (the first family
 *  created lands on id 1). Returns the family id actually present. */
export function ensureFamily(id = 1): number {
  const db = getDB();
  const row = db.prepare("SELECT id FROM families WHERE id = ?").get(id) as { id: number } | undefined;
  if (row) return row.id;
  const created = families.create({
    houseName: `Fixture House ${id}`, houseNumber: "", ward: "", area: "",
    address: "", pincode: "", phone: "9876543210", altPhone: "", status: "Active",
    notes: "", whatsappPhone: "919876543210", whatsappEnabled: 1,
  });
  return created.id;
}

/** Ensure the family has at least one subscription row for the CURRENT month
 *  that is Pending with nothing paid — the shape WhatsApp reminders target. */
export function ensurePendingSubscription(familyId = 1, amount = 100): void {
  const db = getDB();
  const existing = db.prepare("SELECT id FROM subscriptions WHERE family_id = ? LIMIT 1").get(familyId);
  if (existing) return;
  subscriptions.create({ familyId, amount, planId: null } as any);
  db.prepare("UPDATE subscriptions SET amount_paid = 0, status = 'Pending' WHERE family_id = ?").run(familyId);
}

/** Ensure at least one family + head member exists; returns { familyId, memberId }. */
export function ensureFamilyWithHead(): { familyId: number; memberId: number } {
  const db = getDB();
  const existing = db.prepare(
    "SELECT m.id AS memberId, m.family_id AS familyId FROM members m WHERE m.is_head = 1 ORDER BY m.id LIMIT 1"
  ).get() as { memberId: number; familyId: number } | undefined;
  if (existing) return { familyId: existing.familyId, memberId: existing.memberId };
  const familyId = ensureFamily();
  const created: any = members.create({ familyId, name: "Fixture Head", relationship: "Head", gender: "Male", status: "Active" });
  return { familyId, memberId: Number(created.id) };
}

/** Ensure at least one death register row; returns its death_number. */
export function ensureDeathRecord(): string {
  const db = getDB();
  const row = db.prepare("SELECT death_number FROM deaths ORDER BY id LIMIT 1").get() as { death_number: string } | undefined;
  if (row) return row.death_number;
  const created: any = deaths.create({ deceasedName: "Fixture Deceased", dateOfDeath: "2026-08-15", gender: "Male", burialDate: null });
  return created.deathNumber;
}

/** Ensure at least one marriage register row; returns its marriage_number. */
export function ensureMarriageRecord(): string {
  const db = getDB();
  const row = db.prepare("SELECT marriage_number FROM marriages ORDER BY id LIMIT 1").get() as { marriage_number: string } | undefined;
  if (row) return row.marriage_number;
  const created: any = marriages.create({ brideName: "Fixture Bride", groomName: "Fixture Groom", nikahDate: "2026-07-10" });
  return created.marriageNumber;
}
