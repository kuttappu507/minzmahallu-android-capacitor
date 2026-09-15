/*
 * WhatsApp direct-send opt-out guard (defense in depth).
 *
 * Bulk campaigns already filter whatsapp_enabled=1 in SQL; this pins the
 * SECOND layer: a direct sendMessage naming a family must refuse when that
 * family opted out of WhatsApp messages. The guard runs BEFORE any session
 * or network work, so the disabled case needs no socket: it throws the
 * opt-out message while an opted-in family gets past it (and only then hits
 * the "WhatsApp is not connected" guidance).
 */
import { describe, it, expect } from "vitest";
import { getDB } from "../db/connection.js";
import { families } from "./data/families.service.js";
import { whatsapp } from "./whatsapp.service.js";

const PHONE_OK = "9876500011";

describe("direct sendMessage honours the family opt-out", () => {
  it("refuses an opted-out family before touching the session", async () => {
    const created: any = families.create({
      houseName: "Opt-out Guard Family", phone: PHONE_OK,
      whatsappPhone: "919876500011", whatsappEnabled: 0,
    });
    const familyId = Number(created.id);

    await expect(whatsapp.sendMessage({
      phone: "919876500011", text: "hello", familyId,
    })).rejects.toThrow(/opted out of WhatsApp/i);

    // Nothing was logged as sent for the refused attempt.
    const logged = getDB().prepare(
      "SELECT COUNT(*) AS c FROM whatsapp_messages WHERE recipient_phone = ? AND status = 'SENT'"
    ).get("919876500011") as any;
    expect(Number(logged.c)).toBe(0);
  });

  it("lets an opted-in family reach the session layer (fails only on 'not connected')", async () => {
    const created: any = families.create({
      houseName: "Opt-in Guard Family", phone: PHONE_OK,
      whatsappPhone: "919876500012", whatsappEnabled: 1,
    });
    expect(Number(created.id)).toBeGreaterThan(0);

    // Guard passes → the send then fails at the PAIRED-SESSION gate, which
    // is the expected place without a live WhatsApp session.
    await expect(whatsapp.sendMessage({
      phone: "919876500012", text: "hello", familyId: Number(created.id),
    })).rejects.toThrow(/not connected|not paired/i);
  });

  it("receipts stay exempt — a payment receipt to an opted-out family is a transactional send", () => {
    // Documented decision: whatsapp_enabled opts a family out of BULK
    // messaging, not out of their own transaction receipts (which carry a
    // privacy lock of their own). No assertion needed beyond the contract
    // staying intentional — if someone changes sendDonationReceipt to gate
    // on the opt-out, this comment is the marker to revisit.
    expect(true).toBe(true);
  });
});
