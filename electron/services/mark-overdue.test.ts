/*
 * subscriptions.markOverdue — the "Mark Overdue" button.
 * Accounts are rolled to the CURRENT month, so a date-based rule can never
 * fire; a family is overdue when its account carries past-month debt
 * (arrears > 0). Recording a payment recomputes the status and clears the
 * flag when the backlog is gone.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDB } from "../db/connection.js";
import { subscriptions, families } from "./data.service.js";
import { ensureFamily, ensurePendingSubscription } from "./fixtures.js";

describe("subscriptions.markOverdue (arrears-based)", () => {
  beforeAll(() => { getDB(); });

  it("flags accounts with arrears, spares clean ones, clears on payment", () => {
    const db = getDB();
    // Family A: two unpaid past months stacked as arrears.
    const famA = ensureFamily();
    ensurePendingSubscription(famA, 150);
    db.prepare("UPDATE subscriptions SET amount=150, amount_paid=0, arrears=300, advance=0, status='Pending' WHERE family_id=?").run(famA);
    // Family B: a genuinely DISTINCT clean family (ensureFamily() returns the
    // same id when family 1 already exists — create ours explicitly).
    const famB: number = families.create({
      houseName: "Overdue Test Clean House", houseNumber: "", ward: "", area: "",
      address: "", pincode: "", phone: "9198765000", altPhone: "", status: "Active",
      notes: "", whatsappPhone: "919876500001", whatsappEnabled: 1,
    } as any).id;
    ensurePendingSubscription(famB, 150);
    db.prepare("UPDATE subscriptions SET amount=150, amount_paid=0, arrears=0, advance=0, status='Pending' WHERE family_id=?").run(famB);

    const changed = subscriptions.markOverdue();
    expect(changed).toBeGreaterThanOrEqual(1);
    expect((db.prepare("SELECT status FROM subscriptions WHERE family_id=?").get(famA) as any).status).toBe("Overdue");
    expect((db.prepare("SELECT status FROM subscriptions WHERE family_id=?").get(famB) as any).status).toBe("Pending");

    // Recording the full payment (arrears 300 + month 150) recomputes status.
    const rowA = db.prepare("SELECT id FROM subscriptions WHERE family_id=?").get(famA) as any;
    const paid = subscriptions.applyPayment(rowA.id, { amountPaid: 450, paymentDate: "2026-08-20", paymentMethod: "Cash" });
    expect(paid.status).toBe("Paid");
    expect((db.prepare("SELECT status FROM subscriptions WHERE family_id=?").get(famA) as any).status).toBe("Paid");
  });
});
