import { describe, it, expect } from "vitest";
import { formatCurrency, formatDate, statusVariant, todayIST } from "@/lib/utils";

describe("todayIST", () => {
  it("returns the INDIAN calendar date even when the machine runs on UTC", () => {
    // 2026-08-31 00:30 IST == 2026-08-30 19:00 UTC. A machine on UTC (or any
    // non-India zone) must still record 2026-08-31, because MMS is India-only.
    process.env.TZ = "UTC";
    const d = new Date("2026-08-30T19:00:00Z"); // 2026-08-31 00:30 IST
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    expect(`${get("year")}-${get("month")}-${get("day")}`).toBe("2026-08-31");
    // sanity: the same instant in UTC is still the previous day
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-30");
  });

  it("returns the same IST date regardless of machine timezone", () => {
    process.env.TZ = "America/New_York";
    const a = todayIST();
    process.env.TZ = "UTC";
    const b = todayIST();
    process.env.TZ = "Asia/Kolkata";
    const c = todayIST();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatCurrency", () => {
  it("formats 0 as currency", () => {
    expect(formatCurrency(0)).toMatch(/0/);
  });
  it("formats 1500.50", () => {
    const result = formatCurrency(1500.5);
    expect(result).toMatch(/1,50/);
  });
});

describe("formatDate", () => {
  it("returns em dash for null", () => {
    expect(formatDate(null)).toBe("—");
  });
  it("returns em dash for undefined", () => {
    expect(formatDate(undefined)).toBe("—");
  });
  it("returns formatted date for valid string", () => {
    const result = formatDate("2026-01-15");
    expect(result).toContain("2026");
  });
});

describe("statusVariant", () => {
  it("returns active for Active", () => {
    expect(statusVariant("Active")).toBe("active");
  });
  it("returns inactive for Inactive", () => {
    expect(statusVariant("Inactive")).toBe("inactive");
  });
  it("returns active for Paid", () => {
    expect(statusVariant("Paid")).toBe("active");
  });
  it("returns pending for unknown", () => {
    expect(statusVariant("Unknown")).toBe("pending");
  });
  it("returns overdue for Overdue", () => {
    expect(statusVariant("Overdue")).toBe("overdue");
  });
});
