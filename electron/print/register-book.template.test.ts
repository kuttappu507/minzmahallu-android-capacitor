import { describe, it, expect } from "vitest";
import { buildRegisterBookHtml, mapRegisterRow } from "./register-book.template.js";

describe("register-book template", () => {
  it("maps a marriage row to display columns (EN)", () => {
    const m = mapRegisterRow("marriage", {
      marriage_number: "MRG-0001",
      nikah_date: "2025-01-01",
      bride_name: "Aisha",
      bride_father: "Yusuf",
      groom_name: "Bilal",
      groom_father: "Hassan",
      place: "Masjid",
      mahar: "10000",
    }, false);
    expect(m.register_number).toBe("MRG-0001");
    expect(m.cols).toHaveLength(5);
    expect(m.cols[1].value).toContain("Aisha");
    expect(m.cols[1].value).toContain("d/o Yusuf");
  });

  it("maps a death row with localized labels (ML)", () => {
    const d = mapRegisterRow("death", {
      death_number: "DTH-0002",
      deceased_name: "Ibrahim",
      father_name: "Muhammad",
      gender: "Male",
      age: 65,
      date_of_death: "2025-06-15",
      place_of_death: "Home",
      burial_date: "2025-06-16",
      burial_place: "Cemetery",
    }, true);
    expect(d.register_number).toBe("DTH-0002");
    expect(d.cols[0].label).toBe("പേര്");
    expect(d.cols[4].value).toBe("15-06-2025");
  });

  it("builds a paginated register with an integrity line", () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      marriage_number: `MRG-${String(i + 1).padStart(4, "0")}`,
      nikah_date: "2025-01-01",
      bride_name: `Bride ${i}`,
      groom_name: `Groom ${i}`,
    }));
    const html = buildRegisterBookHtml({ type: "marriage", rows, mahalluName: "Minz Mahallu", generatedAt: "2026-08-30T00:00:00Z" }, "en");
    expect(html).toContain("Page 1 / 2");
    expect(html).toContain("Page 2 / 2");
    expect(html).toContain("tamper-evident audit trail");
    expect(html).toContain("MRG-0001");
    expect(html).toContain("MRG-0025");
  });

  it("handles an empty register gracefully", () => {
    const html = buildRegisterBookHtml({ type: "death", rows: [], mahalluName: "Minz Mahallu", generatedAt: "2026-08-30T00:00:00Z" }, "en");
    expect(html).toContain("No entries");
  });
});
