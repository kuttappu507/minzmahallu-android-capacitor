/*
 * Annual Audit Pack — printable Receipts & Payments + Income & Expenditure
 * statement in the format a Kerala Waqf Board / society auditor expects,
 * plus a 65B-style certificate page describing the source system.
 */
import { esc } from "./utils.js";
import { getAnekMalayalamCss } from "./utils.js";

interface PackData {
  fyLabel: string;
  fyYear: number;
  mahalluName: string;
  wakfRegNo: string;
  societyRegNo: string;
  village: string;
  taluk: string;
  district: string;
  state: string;
  opening: number;
  closing: number;
  receipts: { donations: number; subscriptions: number; manual: number };
  payments: { welfare: number; salary: number; manual: number };
  totalReceipts: number;
  totalPayments: number;
  waqfContribution: number;
  transactions: Array<{
    txn_date: string;
    receipt_number: string;
    voucher_no: string;
    bill_no: string;
    payee: string;
    description: string;
    type: string;
    amount: number;
    payment_method: string;
    status: string;
    void_reason: string;
  }>;
  generatedAt: string;
}

function fmtDate(d: string): string {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return String(d);
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    return `${dd}-${mm}-${date.getFullYear()}`;
  } catch { return String(d); }
}

export function buildAuditPackHtml(pack: PackData, lang: 'en' | 'ml' = 'en', currencySymbol: string = '\u20B9'): string {
  // Symbol-aware money formatters live inside the render function so the
  // module stays pure — Settings' currency symbol flows into every amount
  // of the printed audit pack (defaults to ₹).
  const money = (n: number): string =>
    `${String(currencySymbol || '\u20B9')}${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const row = (label: string, amount: number): string =>
    `<tr><td class="lbl">${esc(label)}</td><td class="amt">${money(amount)}</td></tr>`;
  const totalRow = (label: string, amount: number): string =>
    `<tr class="total"><td class="lbl">${esc(label)}</td><td class="amt">${money(amount)}</td></tr>`;
  const ml = lang === 'ml';
  const L = {
    title: ml ? 'വാർഷിക ഓഡിറ്റ് പായ്ക്ക്' : 'ANNUAL AUDIT PACK',
    fy: ml ? 'സാമ്പത്തിക വർഷം' : 'Financial Year',
    rp: ml ? 'രസീതുകളും പേയ്മെന്റുകളും' : 'RECEIPTS & PAYMENTS',
    ie: ml ? 'വരവ് ചെലവ് കണക്ക്' : 'INCOME & EXPENDITURE',
    opening: ml ? 'ആരംഭ ബാലൻസ്' : 'Opening Balance',
    closing: ml ? 'അവസാന ബാലൻസ്' : 'Closing Balance',
    donations: ml ? 'സംഭാവനകൾ' : 'Donations',
    subscriptions: ml ? 'വരിസംഖ്യ' : 'Subscriptions',
    manualIncome: ml ? 'മറ്റ് വരുമാനം' : 'Other Income',
    welfare: ml ? 'ക്ഷേമ വിതരണം' : 'Welfare Disbursed',
    salary: ml ? 'ശമ്പളം' : 'Salaries',
    manualExpense: ml ? 'മറ്റ് ചെലവുകൾ' : 'Other Expenses',
    total: ml ? 'ആകെ' : 'Total',
    waqf: ml ? 'വഖഫ് സംഭാവന (7% — സൂചന)' : 'Waqf Contribution (7% — indicative)',
    vouchers: ml ? 'വൗച്ചർ രജിസ്റ്റർ' : 'VOUCHER REGISTER',
    certPage: ml ? '65B സർട്ടിഫിക്കറ്റ്' : '65B CERTIFICATE',
    signed: ml ? 'ഒപ്പ്' : 'Signature',
    president: ml ? 'പ്രസിഡന്റ്' : 'President',
    secretary: ml ? 'സെക്രട്ടറി' : 'Secretary',
    auditor: ml ? 'ഓഡിറ്റർ' : 'Auditor',
  };
  const anekCss = getAnekMalayalamCss();
  const css = `${anekCss}
  @page{size:A4 portrait;margin:0}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:${ml ? '"Anek Malayalam Variable",' : ''}Poppins,"Anek Malayalam Variable","Segoe UI",Arial,sans-serif;color:#1a2b22;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;min-height:297mm;padding:12mm 14mm;position:relative;page-break-after:always}
  .page:last-child{page-break-after:auto}
  .head{text-align:center;border-bottom:.4mm solid #0e7c5b;padding-bottom:3mm;margin-bottom:5mm}
  .head h1{font-size:15pt;color:#0e7c5b;letter-spacing:1px}
  .head .mname{font-size:17pt;font-weight:700}
  .head .sub{font-size:8.5pt;color:#5f7268;margin-top:1mm}
  h2{font-size:11pt;margin:4mm 0 2mm;color:#0e7c5b;letter-spacing:.5px}
  table{width:100%;border-collapse:collapse;font-size:9pt}
  th,td{padding:1.8mm 2.5mm;border:.25mm solid #cfdfd6;text-align:left;vertical-align:top}
  th{background:#eef7f1;font-size:8pt;letter-spacing:.4px}
  td.amt{text-align:right;font-family:'Courier New',monospace}
  tr.total td{font-weight:700;background:#f6faf7;border-top:.45mm solid #0e7c5b}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:5mm}
  .box{border:.3mm solid #cfdfd6;border-radius:1.5mm;padding:3mm}
  .note{font-size:7.5pt;color:#5f7268;margin-top:2mm}
  .sign-row{display:flex;justify-content:space-between;margin-top:14mm}
  .sign{width:52mm;text-align:center}
  .sign .line{border-top:.3mm solid #5f7268;margin-top:14mm;padding-top:1.5mm;font-size:8pt}
  .cert{text-align:center;border:.5mm solid #0e7c5b;border-radius:2mm;padding:8mm;margin-top:6mm}
  .cert h3{font-size:12pt;color:#0e7c5b;margin-bottom:3mm}
  .cert p{font-size:9.5pt;line-height:1.7;text-align:left;margin-bottom:2mm}
  .void{color:#b02a37;font-style:italic}
  `;

  const head = (title: string) => `<div class="head"><div class="mname">${esc(pack.mahalluName)}</div><h1>${title}</h1><div class="sub">${L.fy}: ${esc(pack.fyLabel)} · ${esc([pack.village, pack.taluk, pack.district, pack.state].filter(Boolean).join(", "))}${pack.wakfRegNo ? ` · ${esc(pack.wakfRegNo)}` : ""}${pack.societyRegNo ? ` · ${esc(pack.societyRegNo)}` : ""}</div></div>`;

  // Receipts & Payments
  const rp = `<div class="page">${head(L.rp)}
    <div class="grid2">
      <div class="box"><h2>${L.rp}</h2><table>
        ${row(L.opening, pack.opening)}
        ${row(`${L.donations}`, pack.receipts.donations)}
        ${row(`${L.subscriptions}`, pack.receipts.subscriptions)}
        ${row(`${L.manualIncome}`, pack.receipts.manual)}
        ${totalRow(`${L.total} ${L.donations}/${L.subscriptions}`, pack.totalReceipts)}
      </table></div>
      <div class="box"><table>
        ${row(L.welfare, pack.payments.welfare)}
        ${row(L.salary, pack.payments.salary)}
        ${row(L.manualExpense, pack.payments.manual)}
        ${totalRow(`${L.total} ${L.welfare}/${L.salary}`, pack.totalPayments)}
        ${totalRow(L.closing, pack.closing)}
      </table></div>
    </div>
    <p class="note">${esc(pack.mahalluName)} · ${L.fy}: ${esc(pack.fyLabel)}. ${L.waqf}: <b>${money(pack.waqfContribution)}</b> (7% of ${L.total} ${L.donations}/${L.subscriptions}).</p>
    <div class="sign-row">
      <div class="sign"><div class="line">${L.president} · ${L.signed}</div></div>
      <div class="sign"><div class="line">${L.secretary} · ${L.signed}</div></div>
      <div class="sign"><div class="line">${L.auditor} · ${L.signed}</div></div>
    </div>
  </div>`;

  // Income & Expenditure
  const net = pack.totalReceipts - pack.totalPayments;
  const ie = `<div class="page">${head(L.ie)}
    <div class="grid2">
      <div class="box"><h2>${L.total} ${L.donations}/${L.subscriptions}</h2><table>
        ${row(L.donations, pack.receipts.donations)}
        ${row(L.subscriptions, pack.receipts.subscriptions)}
        ${row(L.manualIncome, pack.receipts.manual)}
        ${totalRow(L.total, pack.totalReceipts)}
      </table></div>
      <div class="box"><h2>${L.total} ${L.welfare}/${L.salary}</h2><table>
        ${row(L.welfare, pack.payments.welfare)}
        ${row(L.salary, pack.payments.salary)}
        ${row(L.manualExpense, pack.payments.manual)}
        ${totalRow(L.total, pack.totalPayments)}
      </table></div>
    </div>
    <table style="margin-top:3mm">${totalRow(net >= 0 ? (ml ? 'മിച്ചം (വരുമാനം − ചെലവ്)' : 'Surplus (Income − Expense)') : (ml ? 'കമ്മി (വരുമാനം − ചെലവ്)' : 'Deficit (Income − Expense)'), net)}</table>
    <div class="sign-row">
      <div class="sign"><div class="line">${L.president} · ${L.signed}</div></div>
      <div class="sign"><div class="line">${L.secretary} · ${L.signed}</div></div>
      <div class="sign"><div class="line">${L.auditor} · ${L.signed}</div></div>
    </div>
  </div>`;

  // Voucher register
  const vrows = pack.transactions.length
    ? pack.transactions.map((t) => `<tr><td>${fmtDate(t.txn_date)}</td><td>${esc(t.voucher_no || "—")}</td><td>${esc(t.receipt_number || "—")}</td><td>${esc(t.payee || "—")}</td><td>${esc(t.bill_no || "—")}</td><td>${esc(t.description || "—")}${t.status === "Void" ? ` <span class="void">[VOID${t.void_reason ? " — " + esc(t.void_reason) : ""}]</span>` : ""}</td><td class="amt">${money(t.amount)}</td></tr>`).join("")
    : `<tr><td colspan="7" style="text-align:center;color:#8ba096">${ml ? "രേഖകളില്ല" : "No entries"}</td></tr>`;
  const vouchers = `<div class="page">${head(L.vouchers)}
    <table>
      <tr><th>${ml ? "തീയതി" : "Date"}</th><th>${ml ? "വൗച്ചർ" : "Voucher"}</th><th>${ml ? "രസീത്" : "Receipt"}</th><th>${ml ? "സ്വീകർത്താവ്" : "Payee"}</th><th>${ml ? "ബിൽ നം." : "Bill No."}</th><th>${ml ? "വിവരണം" : "Description"}</th><th>${ml ? "തുക" : "Amount"}</th></tr>
      ${vrows}
    </table>
    <p class="note">${ml ? "വൗച്ചറുകളും ബിൽ നമ്പറുകളും ഓഡിറ്റ് രേഖകളായി സൂക്ഷിക്കുന്നു." : "Voucher and bill numbers are retained as audit evidence."}</p>
    <div class="sign-row">
      <div class="sign"><div class="line">${L.secretary} · ${L.signed}</div></div>
    </div>
  </div>`;

  // 65B certificate page
  const cert65 = `<div class="page">${head(L.certPage)}
    <div class="cert">
      <h3>${ml ? "ഇലക്ട്രോണിക് രേഖ സർട്ടിഫിക്കറ്റ്" : "CERTIFICATE OF ELECTRONIC RECORD"}</h3>
      <p>${ml
        ? `മേൽപ്പറഞ്ഞ കണക്കുകളും രേഖകളും "${esc(pack.mahalluName)}" എന്ന സ്ഥാപനത്തിന്റെ ഔദ്യോഗിക രേഖകളിൽ നിന്ന് MMS (Minz Mahallu Management System) ആപ്ലിക്കേഷനിൽ നിന്ന് സാധാരണ പ്രവർത്തന രീതിയിൽ സൃഷ്ടിച്ചതാണ്. രേഖകൾ ഒരു ഹാഷ്-പരിശോധിച്ച ഓഡിറ്റ് ട്രയിൽ ഉപയോഗിച്ച് സംരക്ഷിക്കപ്പെട്ടിരിക്കുന്നു.`
        : `The above accounts and records were generated in the ordinary course of operations from the official records of "${esc(pack.mahalluName)}" using the MMS (Minz Mahallu Management System) application. The records are protected by an append-only, hash-verified audit trail.`}</p>
      <p>${ml ? "സൃഷ്ടിച്ച തീയതി:" : "Generated on:"} ${fmtDate(pack.generatedAt)} · MMS v2.0</p>
      <p style="margin-top:4mm">${ml ? "ഉത്തരവാദിത്തമുള്ള ഉദ്യോഗസ്ഥന്റെ ഒപ്പ്" : "Signature of the person in responsible charge"}</p>
      <div style="border-top:.3mm solid #5f7268;width:60mm;margin:16mm auto 0"></div>
    </div>
  </div>`;

  return `<!doctype html><html lang="${ml ? 'ml' : 'en'}"><head><meta charset="utf-8"><title>Audit Pack ${esc(pack.fyLabel)}</title><style>${css}</style></head><body>${rp}${ie}${vouchers}${cert65}</body></html>`;
}
