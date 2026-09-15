/*
 * Token collection sheet — column contract:
 *   No. | Token | FAMILY HEAD NAME | FAMILY NAME | AREA (name only) |
 *   Collected | Signature
 *
 * The sheet is used at the venue gate to tick off returned tokens, so the
 * family head's name must come FIRST after the token number, the family
 * (house) name second, and the area as a BARE NAME — the old ward-number /
 * house-number columns are gone.
 */
import { describe, it, expect } from "vitest";
import { buildCollectionSheetHtml } from "./collection-sheet.template.js";
import { getDB } from "../db/connection.js";

const event = { event_name: "Annual General Body", event_date: "2027-01-10" };

const rows = [
  {
    token_code: "TKN-2026-0001", house_head_name: "Abdul Rahman",
    house_name: "Thottathil House", area: "Kondotty", ward: "4",
    house_number: "12", family_number: "F-101",
  },
  {
    token_code: "TKN-2026-0002", house_head_name: "",
    house_name: "Kunju House", area: "", ward: "Meleparamba",
    house_number: "7", family_number: "F-102",
  },
];

describe("collection sheet columns", () => {
  const html = buildCollectionSheetHtml(rows, event);

  it("orders headers: token, family head, family name, area", () => {
    const th = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    const iHead = th.indexOf("Family Head");
    const iFamily = th.indexOf("Family Name");
    const iArea = th.indexOf("Area");
    expect(iHead).toBeGreaterThan(-1);
    expect(iFamily).toBeGreaterThan(iHead);
    expect(iArea).toBeGreaterThan(iFamily);
  });

  it("drops the old House No. and Ward columns", () => {
    expect(html).not.toContain("House No.");
    expect(html).not.toContain("<th>Ward</th>");
  });

  it("prints head name, family name and the bare area name", () => {
    expect(html).toContain("Abdul Rahman");
    expect(html).toContain("Thottathil House");
    expect(html).toContain("<td>Kondotty</td>");
    // No area on file -> falls back to the ward NAME, never a bare number
    expect(html).toContain("<td>Meleparamba</td>");
    // Head missing -> em dash placeholder, never the family number
    expect(html).toContain('<td class="hname">—</td>');
  });

  it("never leaks house/family numbers into the rows", () => {
    expect(html).not.toContain("F-101");
    expect(html).not.toContain("F-102");
    expect(html).not.toContain(">12<");
    expect(html).not.toContain(">7<");
  });

  it("keeps token code, tick box, signature column and the total", () => {
    expect(html).toContain("TKN-2026-0001");
    expect(html).toContain('class="check">□</td>');
    expect(html).toContain("Signature");
    expect(html).toContain("Total: 2");
  });
});

describe("collection sheet follows the app language (Malayalam)", () => {
  it("renders Malayalam headers when settings.language = ml", () => {
    const db = getDB();
    const row = db.prepare("SELECT language FROM settings WHERE id = 1").get() as { language?: string } | undefined;
    if (!row) return; // settings row not provisioned in this environment
    db.prepare("UPDATE settings SET language = 'ml' WHERE id = 1").run();
    try {
      const html = buildCollectionSheetHtml(rows, event);
      expect(html).toContain("ടോക്കൺ ശേഖരണ ഷീറ്റ്");
      expect(html).toContain("<th>കുടുംബനാഥൻ</th>");   // family head
      expect(html).toContain("<th>വീടിന്റെ പേര്</th>");  // family name
      expect(html).toContain("<th>പ്രദേശം</th>");       // area
      expect(html).not.toContain("Family Head");
    } finally {
      db.prepare("UPDATE settings SET language = ? WHERE id = 1").run(row.language || "en");
    }
  });
});
