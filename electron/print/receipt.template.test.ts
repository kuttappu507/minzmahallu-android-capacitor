import { describe, it, expect } from "vitest";
import { buildReceiptHtml, buildReceiptSheetHtml, amountInWords, formatReceiptAmount, type ReceiptData } from "./receipt.template.js";

const donation: ReceiptData = {
  kind: "DONATION",
  receiptNumber: "DON-042",
  date: "15-09-2026",
  payerName: "Haji Abdulla",
  payerDetail: "919876543210",
  line1Label: "Category",
  line1Value: "Zakat",
  line2Label: "Purpose",
  line2Value: "Ramzan fund",
  amount: 1500,
  paymentMethod: "UPI",
  transactionRef: "UPI-334455",
  notes: "Paid via Google Pay",
  mahalluName: "Minz Mahallu",
  mahalluAddress: "Minz Road, Malappuram",
  verificationCode: "AB2C-3D4E-F6GH",
};

const subscription: ReceiptData = {
  kind: "SUBSCRIPTION",
  receiptNumber: "RCP-0007",
  date: "31-08-2026",
  payerName: "Kunju House",
  payerDetail: "FAM-012",
  line1Label: "Month",
  line1Value: "August 2026",
  line2Label: "Monthly due",
  line2Value: "\u20B9150",
  amount: 100,
  paymentMethod: "Cash",
  transactionRef: "",
  mahalluName: "Minz Mahallu",
  footNote: "Balance this month: \u20B950",
};

describe("A6 receipt template", () => {
  it("renders a single A6 receipt with dd-mm-yyyy date and key fields", () => {
    const html = buildReceiptHtml(donation, "en");
    expect(html).toContain("@page{size:105mm 148mm");
    expect(html).toContain("DON-042");
    expect(html).toContain("15-09-2026");
    expect(html).toContain("Haji Abdulla");
    expect(html).toContain("Zakat");
    expect(html).toContain("DONATION RECEIPT");
    expect(html).not.toContain("2026-09-15"); // never the storage order
  });

  it("carries the security-code footer, header address and bottom brand — and no QR", () => {
    const html = buildReceiptHtml(donation, "en");
    expect(html).toContain("SECURITY CODE");
    expect(html).toContain("AB2C-3D4E-F6GH");
    expect(html).toContain("Minz Road, Malappuram");
    expect(html).toContain('class="rc-app"');
    expect(html).toContain("Minz Mahallu Management System");
    expect(html).not.toContain("rc-qr");
    expect(html).not.toContain("data:image/svg+xml");
  });

  it("renders the amount with the en-IN grouping and words", () => {
    const html = buildReceiptHtml(donation, "en");
    expect(html).toContain("\u20B91,500");
    expect(html).toContain("Rupees One Thousand Five Hundred Only");
    expect(amountInWords(1500)).toBe("Rupees One Thousand Five Hundred Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(10000000)).toBe("Rupees One Crore Only");
    expect(amountInWords(125000)).toBe("Rupees One Lakh Twenty Five Thousand Only");
    expect(formatReceiptAmount(1250.5)).toBe("\u20B91,250.5");
  });

  it("escapes HTML in user-supplied fields", () => {
    const risky: ReceiptData = { ...donation, payerName: "<script>alert(1)</script>", line2Value: "&<>" };
    const html = buildReceiptHtml(risky, "en");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("subscription receipt shows the balance foot note", () => {
    const html = buildReceiptHtml(subscription, "en");
    expect(html).toContain("Balance this month: \u20B950");
    expect(html).toContain("SUBSCRIPTION RECEIPT");
  });

  it("renders Malayalam labels for ml", () => {
    const html = buildReceiptHtml(donation, "ml");
    expect(html).toContain("\u0d30\u0d38\u0d40\u0d31\u0d4d\u0d31\u0d4d"); // രസീറ്റ്
    expect(html).toContain("\u0d24\u0d40\u0d2f\u0d24\u0d3f"); // തീയതി
  });

  it("builds a 4-per-A4 sheet with exactly 4 cells per page", () => {
    const list = [donation, subscription, { ...donation, receiptNumber: "DON-043" }, { ...donation, receiptNumber: "DON-044" }, { ...donation, receiptNumber: "DON-045" }];
    const html = buildReceiptSheetHtml(list, "en");
    expect(html).toContain("@page{size:A4 portrait");
    const sheets = html.match(/<section class="sheet">/g) || [];
    expect(sheets.length).toBe(2); // 5 receipts → 2 sheets
    const cells = html.match(/<div class="cell">/g) || [];
    expect(cells.length).toBe(8); // padded to full 2x2 grids
    expect(html).toContain("DON-045");
    expect(html).toContain("5 receipts"); // footer count
  });
});
