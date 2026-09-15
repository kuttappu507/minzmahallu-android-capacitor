/*
 * Arrears & advance engine (V036) + WhatsApp receipt send-lock (V037).
 *
 * The subscription account is a recurring ledger: each month's unpaid balance
 * becomes ARREARS at roll-over ("3 months due"), an overpayment becomes
 * ADVANCE credit that nets against future dues, and cash given in a month is
 * applied OLDEST-FIRST (old arrears → this month's rate → advance). Re-record
 * and cancel roll the allocation back exactly.
 *
 * The send-lock: a receipt may leave the app once — only the recipient's
 * phone CONFIRMING delivery locks it, plus ONE admin-authorized re-send.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDB } from "../db/connection.js";
import { subscriptions, families } from "./data.service.js";
import {
  receiptSendState, markReceiptAccepted, markReceiptDelivered,
  markReceiptDeliveredByMsgId, consumeAdminResend,
} from "./receipt.service.js";
import { waitForDelivery } from "./whatsapp-engine.service.js";

let familyId = 0;
let subId = 0;
const RATE = 150;

function account(): any {
  return getDB().prepare("SELECT * FROM subscriptions WHERE id = ?").get(subId) as any;
}
function ledgerRow(): any {
  return getDB()
    .prepare("SELECT * FROM subscription_payments WHERE subscription_id = ? AND period_start = ? AND status = 'Active' LIMIT 1")
    .get(subId, account().period_start) as any;
}
const clean = (n: number | null | undefined) => Math.round(Number(n || 0) * 100) / 100;

beforeAll(() => {
  getDB(); // schema + migrations (fresh DBs are empty — the demo dataset was retired)
  // The roll-over engine bills at the CONFIGURED monthly rate; pin it to the
  // rate this suite's math assumes instead of relying on shipped demo settings.
  getDB().prepare("UPDATE settings SET subscription_monthly_amount = ? WHERE id = 1").run(RATE);
  const fam = families.create({ houseName: "Arrears Engine Test Family" });
  familyId = Number(fam.id);
  const created = subscriptions.create({ familyId, amount: RATE, amountPaid: 0, paymentMethod: "Cash" }) as any;
  subId = Number(created.id);
});

afterAll(() => {
  // Throwaway DB — best-effort cleanup keeps the demo rows untouched.
  try {
    getDB().prepare("DELETE FROM subscription_payments WHERE subscription_id = ?").run(subId);
    getDB().prepare("DELETE FROM subscriptions WHERE id = ?").run(subId);
  } catch { /* ignore */ }
});

describe("payment allocation — oldest first (V036)", () => {
  it("partial payment: due 150, paid 100 → Partial, no arrears, no advance", () => {
    const r = subscriptions.applyPayment(subId, { amountPaid: 100, paymentDate: "2026-09-02", paymentMethod: "Cash" });
    expect(clean(r.arrears)).toBe(0);
    expect(clean(r.advance)).toBe(0);
    expect(r.status).toBe("Partial");
    expect(clean(r.monthPaid)).toBe(100);
    expect(clean(r.dueTotal)).toBe(50);
    const s = account();
    expect(clean(s.amount_paid)).toBe(100);
    expect(clean(s.arrears)).toBe(0);
    expect(clean(s.advance)).toBe(0);
  });

  it("the mahallu's exact case: due 150, paid 200 → ₹50 becomes advance", () => {
    const r = subscriptions.applyPayment(subId, { amountPaid: 200, paymentDate: "2026-09-03", paymentMethod: "Cash" });
    expect(clean(r.advance)).toBe(50);
    expect(r.status).toBe("Paid");
    expect(clean(r.monthPaid)).toBe(150);
    expect(clean(r.dueTotal)).toBe(0);
    const s = account();
    // amount_paid is the THIS-MONTH portion only (capped at the rate)…
    expect(clean(s.amount_paid)).toBe(150);
    // …the ₹50 rides as advance credit.
    expect(clean(s.advance)).toBe(50);
    const ledger = ledgerRow();
    expect(clean(ledger.amount)).toBe(200);
    expect(clean(ledger.advance_added)).toBe(50);
    expect(clean(ledger.arrears_cleared)).toBe(0);
  });

  it("the receipt number issued for the month survives re-recording (never renumbered)", () => {
    const first = ledgerRow().receipt_number;
    expect(first).toBeTruthy();
    subscriptions.applyPayment(subId, { amountPaid: 150, paymentDate: "2026-09-04", paymentMethod: "Cash" });
    expect(ledgerRow().receipt_number).toBe(first);
  });

  it("re-recording rolls the previous allocation back exactly (200 → 150 leaves no phantom advance)", () => {
    const r = subscriptions.applyPayment(subId, { amountPaid: 150, paymentDate: "2026-09-04", paymentMethod: "Cash" });
    expect(clean(r.advance)).toBe(0);
    expect(clean(r.monthPaid)).toBe(150);
    const s = account();
    expect(clean(s.amount_paid)).toBe(150);
    expect(clean(s.advance)).toBe(0);
    expect(clean(ledgerRow().amount)).toBe(150);
    expect(clean(ledgerRow().advance_added)).toBe(0);
  });
});

describe("month roll-over carries dues and credit (multi-month accounts)", () => {
  // Simulating a month change on the throwaway DB: the account row AND its
  // current-month ledger row move back together (in real operation they are
  // always in the same period — the roll moves the account forward and the
  // ledger row stays behind as history).
  const rewindOneMonth = () => {
    const db = getDB();
    db.prepare(
      "UPDATE subscriptions SET period_start = date('now','localtime','start of month','-1 month'), period_end = date('now','localtime','start of month','-1 day') WHERE id = ?"
    ).run(subId);
    db.prepare(
      "UPDATE subscription_payments SET period_start = date('now','localtime','start of month','-1 month'), period_end = date('now','localtime','start of month','-1 day') WHERE subscription_id = ? AND period_start = date('now','localtime','start of month')"
    ).run(subId);
  };

  it("a month closed at 50/150 pushes ₹100 into arrears; advance nets incoming dues first", () => {
    // Month A: the family overpays (190 = 150 this month + 40 advance)…
    subscriptions.applyPayment(subId, { amountPaid: 190, paymentDate: "2026-09-05", paymentMethod: "Cash" });
    expect(clean(account().advance)).toBe(40);
    // …rolls into a fresh month (fully-paid month: the ₹40 advance carries)…
    rewindOneMonth();
    subscriptions.ensureCurrentMonth();
    expect(clean(account().advance)).toBe(40);
    expect(clean(account().arrears)).toBe(0);
    expect(clean(account().amount_paid)).toBe(0);
    // …then closes THAT month half-paid (50 of 150)…
    subscriptions.applyPayment(subId, { amountPaid: 50, paymentDate: "2026-09-06", paymentMethod: "Cash" });
    expect(clean(account().amount_paid)).toBe(50);
    expect(clean(account().advance)).toBe(40);
    // …and the next roll turns the unpaid ₹100 into arrears, netting the
    // standing ₹40 advance first → exactly ₹60 carried.
    rewindOneMonth();
    subscriptions.ensureCurrentMonth();
    const s = account();
    expect(clean(s.arrears)).toBe(60);
    expect(clean(s.advance)).toBe(0);
    expect(clean(s.amount_paid)).toBe(0);
    expect(s.status).toBe("Pending");
  });

  it("memberBalance reports the TRUE dues (arrears + month − advance), never negative", () => {
    expect(clean(subscriptions.memberBalance(familyId))).toBe(60 + RATE);
  });

  it("catch-up payment clears old arrears FIRST: 60 old + 150 month, pay 250 → fully settled", () => {
    const r = subscriptions.applyPayment(subId, { amountPaid: 250, paymentDate: "2026-09-06", paymentMethod: "Cash" });
    expect(r.status).toBe("Paid");
    expect(clean(r.arrears)).toBe(0);
    expect(clean(r.monthPaid)).toBe(150);
    const ledger = ledgerRow();
    expect(clean(ledger.arrears_cleared)).toBe(60);
    expect(clean(ledger.advance_added)).toBe(40);
    expect(clean(subscriptions.memberBalance(familyId))).toBe(0);
  });

  it("cancelling the month's payment puts the allocation back (arrears return, advance withdraws)", () => {
    subscriptions.cancelPayment(subId);
    const s = account();
    expect(clean(s.arrears)).toBe(60);
    expect(clean(s.advance)).toBe(0);
    expect(clean(s.amount_paid)).toBe(0);
    expect(s.status).toBe("Pending");
    expect(clean(subscriptions.memberBalance(familyId))).toBe(60 + RATE);
    // The ledger row is Cancelled, not deleted — the immutable history.
    const cancelled = getDB()
      .prepare("SELECT status FROM subscription_payments WHERE subscription_id = ? ORDER BY id DESC LIMIT 1")
      .get(subId) as any;
    expect(cancelled.status).toBe("Cancelled");
  });
});

describe("WhatsApp receipt send-lock — only DELIVERY locks (V037)", () => {
  it("a send attempt alone does NOT lock: accepted ≠ delivered", () => {
    subscriptions.applyPayment(subId, { amountPaid: 60, paymentDate: "2026-09-07", paymentMethod: "Cash" });
    const paymentId = Number(ledgerRow().id);
    // Before anything: open.
    expect(receiptSendState("subscription", paymentId).delivered).toBe(false);
    // The WhatsApp server accepted the message…
    markReceiptAccepted("subscription", paymentId, "MSG-TEST-1");
    const afterAccept = receiptSendState("subscription", paymentId);
    expect(afterAccept.sent).toBe(true);
    // …but the phone has not confirmed it — STILL NOT LOCKED (the mahallu's
    // rule: no false "already sent" when the network or WhatsApp dropped).
    expect(afterAccept.delivered).toBe(false);
    expect(afterAccept.msgId).toBe("MSG-TEST-1");
  });

  it("late delivery (phone came online later) flips the lock via the stored message id", () => {
    const paymentId = Number(ledgerRow().id);
    // A delivery receipt for an UNRELATED message id touches nothing.
    markReceiptDeliveredByMsgId("MSG-OTHER");
    expect(receiptSendState("subscription", paymentId).delivered).toBe(false);
    // The real one lands hours later.
    markReceiptDeliveredByMsgId("MSG-TEST-1");
    expect(receiptSendState("subscription", paymentId).delivered).toBe(true);
    expect(receiptSendState("subscription", paymentId).deliveredAt).toBeTruthy();
  });

  it("delivered ⇒ locked; the ONE admin re-send is spent exactly once", () => {
    const paymentId = Number(ledgerRow().id);
    // Simulate the lock moment directly for the non-delivered edge too.
    markReceiptDelivered("subscription", paymentId);
    expect(receiptSendState("subscription", paymentId).resends).toBe(0);
    // First admin re-send: allowed, counter 0 → 1.
    expect(consumeAdminResend("subscription", paymentId)).toBe(1);
    // The one re-send is gone forever.
    expect(() => consumeAdminResend("subscription", paymentId)).toThrow(/already used/i);
    expect(receiptSendState("subscription", paymentId).resends).toBe(1);
  });

  it("waitForDelivery reports honestly when no confirmation arrives (timeout, no lock)", async () => {
    const t0 = Date.now();
    const delivered = await waitForDelivery("MSG-NEVER-CONFIRMED", 80);
    expect(delivered).toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
  });
});
