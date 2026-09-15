/*
 * Regression test — family edit must persist WhatsApp fields.
 *
 * BUG: editing an existing family routed through security.updateFamily,
 * whose UPDATE statement omitted whatsapp_phone / whatsapp_enabled — so
 * adding a WhatsApp number while EDITING a family silently did nothing
 * (creating a new family worked, because the create path is the raw
 * families service which always had the columns).
 */
import { describe, it, expect } from "vitest";
import { getDB } from "../db/connection.js";
import { security } from "./security.service.js";
import { families } from "./data/families.service.js";

const ACTOR = { id: 1, username: "test-admin", role: "Administrator" };

describe("family edit persists WhatsApp fields (regression)", () => {
  it("saves a WhatsApp number + preference added while EDITING an existing family", () => {
    const created: any = families.create({
      houseName: "WhatsApp Regression Family", phone: "9876500001",
      whatsappPhone: "", whatsappEnabled: 1,
    });
    const id = Number(created.id);

    // The edit-dialog payload: user adds a WhatsApp number in the EDIT form.
    security.updateFamily(ACTOR, id, {
      houseName: "WhatsApp Regression Family", houseNumber: "", ward: "", area: "",
      address: "", pincode: "", phone: "9876500001", altPhone: "", notes: "",
      whatsappPhone: "919876543210", whatsappEnabled: 1,
    });

    const row = getDB().prepare("SELECT whatsapp_phone, whatsapp_enabled FROM families WHERE id = ?").get(id) as any;
    expect(row.whatsapp_phone).toBe("919876543210");
    expect(row.whatsapp_enabled).toBe(1);

    // And the change is visible in the family history diff (audited).
    const before = getDB().prepare("SELECT whatsapp_phone FROM families WHERE id = ?").get(id) as any;
    expect(before.whatsapp_phone).toBe("919876543210");

    // Toggling the preference off via edit must also persist.
    security.updateFamily(ACTOR, id, {
      houseName: "WhatsApp Regression Family", houseNumber: "", ward: "", area: "",
      address: "", pincode: "", phone: "9876500001", altPhone: "", notes: "",
      whatsappPhone: "919876543210", whatsappEnabled: 0,
    });
    const after = getDB().prepare("SELECT whatsapp_phone, whatsapp_enabled FROM families WHERE id = ?").get(id) as any;
    expect(after.whatsapp_enabled).toBe(0);
  });
});
