/*
 * Receipt template — anti-forgery SECURITY CODE footer (A6 single + A4 sheet).
 *
 * Receipts carry a security code instead of a signature block: they are
 * computer-generated documents. By design there is NO QR image on the printed
 * receipt — the register verification code IS the anti-forgery element. The
 * code must appear in BOTH output shapes (they share one card design), the
 * header must show the mahallu name + address like the certificate, the title
 * must say the receipt type explicitly, and the app brand must appear in very
 * small letters at the bottom.
 */
import { describe, it, expect } from "vitest";
import { buildReceiptHtml, buildReceiptSheetHtml, amountInWords, type ReceiptData } from "../print/receipt.template.js";

const base: ReceiptData = {
  kind: "DONATION",
  receiptNumber: "MMJM/26/09/001",
  date: "15-09-2026",
  payerName: "Abdul Rahman",
  payerDetail: "9847010001",
  line1Label: "Category",
  line1Value: "General Donation",
  line2Label: "Purpose",
  line2Value: "Jumuah collection",
  amount: 2500,
  paymentMethod: "UPI",
  transactionRef: "UPI-99012341",
  notes: "",
  mahalluName: "Minz Mahallu Jamath",
  mahalluAddress: "Minz Street, Kondotty",
  mahalluPhone: "0483 000 0000",
  verificationCode: "WK4M-8Q7Z-T3HD",
};

describe("A6 receipt — security-code footer replaces the signature (no QR)", () => {
  const html = buildReceiptHtml(base, "en");

  it("prints NO QR image — the security code is the anti-forgery element", () => {
    expect(html).not.toContain('class="rc-qr"');
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("prints the security code with its caption", () => {
    expect(html).toContain("SECURITY CODE");
    expect(html).toContain("WK4M-8Q7Z-T3HD");
    expect(html).toContain("Verify this security code at the mahallu office or in the Minz Mahallu app.");
  });

  it("header shows the mahallu name with address (+ phone) like the certificate", () => {
    expect(html).toContain("Minz Mahallu Jamath");
    expect(html).toContain("Minz Street, Kondotty · 0483 000 0000");
    // No "Mahallu Management System" in the header — brand moved to the bottom.
    expect(html).not.toContain("Mahallu Management System<span");
  });

  it("states the receipt type explicitly in the title", () => {
    expect(html).toContain("DONATION RECEIPT");
    const sub = buildReceiptHtml({ ...base, kind: "SUBSCRIPTION" }, "en");
    expect(sub).toContain("SUBSCRIPTION RECEIPT");
  });

  it("prints the app brand in very small letters at the bottom", () => {
    expect(html).toContain('class="rc-app"');
    expect(html).toContain("Minz Mahallu Management System");
  });

  it("states the receipt is computer-generated — no signature required", () => {
    expect(html).toContain("Computer-generated receipt — no signature required.");
    expect(html).toContain("For Minz Mahallu Jamath");
    expect(html).toContain("Jazakallahu Khairan.");
  });

  it("drops the old signature block entirely", () => {
    expect(html).not.toContain("rc-sign");
    expect(html).not.toContain(">Signature<");
  });

  it("renders the same footer bilingually", () => {
    const ml = buildReceiptHtml(base, "ml");
    expect(ml).toContain("\u0d38\u0d41\u0d30\u0d15\u0d4d\u0d37\u0d3e \u0d15\u0d4b\u0d21\u0d4d"); // സുരക്ഷാ കോഡ്
    expect(ml).toContain("കമ്പ്യൂട്ടർ ജനറേറ്റ് ചെയ്ത രസീറ്റ് — ഒപ്പ് ആവശ്യമില്ല.");
    expect(ml).toContain("WK4M-8Q7Z-T3HD");
    expect(ml).toContain("\u0d38\u0d02\u0d2d\u0d3e\u0d35\u0d28 \u0d30\u0d38\u0d40\u0d31\u0d4d\u0d31\u0d4d"); // സംഭാവന രസീറ്റ്
    expect(ml).not.toContain("rc-sign");
  });

  it("keeps the amount block untouched (words + ₹)", () => {
    expect(html).toContain("₹2,500");
    expect(html).toContain(amountInWords(2500));
  });
});

describe("A4 4-up sheet — every receipt card carries the security code", () => {
  const second: ReceiptData = { ...base, receiptNumber: "MMJM/26/09/002", verificationCode: "A9BX-C2VP-M5KS" };
  const html = buildReceiptSheetHtml([base, second], "en");

  it("renders the code for each receipt and no QR anywhere (shared card design)", () => {
    expect((html.match(/WK4M-8Q7Z-T3HD/g) || []).length).toBe(1);
    expect(html).toContain("A9BX-C2VP-M5KS");
    expect((html.match(/SECURITY CODE/g) || []).length).toBe(2);
    expect(html).not.toContain("rc-qr");
  });

  it("keeps cut guides and sheet footer metadata", () => {
    expect(html).toContain("4 / A4");
    expect(html).toContain("2 receipts");
  });

  it("has no signature blocks on the sheet either", () => {
    expect(html).not.toContain("rc-sign");
    expect(html).not.toContain(">Signature<");
  });
});
