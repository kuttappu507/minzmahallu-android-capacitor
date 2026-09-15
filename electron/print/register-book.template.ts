/*
 * Register-book printing — a paginated, numbered marriage / death register in
 * the style of the official mahallu registers, with signature lines and an
 * integrity line ("N entries, no deletions").
 */
import { esc } from "./utils.js";
import { getAnekMalayalamCss } from "./utils.js";

/** Raw register row as returned by data.service (marriages.registerRows / deaths.registerRows). */
export type RegisterRow = Record<string, any>;

export interface RegisterData {
  type: "marriage" | "death";
  rows: RegisterRow[];
  mahalluName: string;
  generatedAt: string;
}

const ENTRIES_PER_PAGE = 22;

/**
 * Map a raw register row to display columns with localized labels.
 * Pure — no DB access, so it is unit-testable.
 */
export function mapRegisterRow(type: "marriage" | "death", r: RegisterRow, ml: boolean): { register_number: string; cols: Array<{ label: string; value: string }> } {
  if (type === "marriage") {
    return {
      register_number: r.marriage_number || "—",
      cols: [
        { label: ml ? "നിക്കാഹ് തീയതി" : "Nikah Date", value: fmtDate(r.nikah_date) },
        { label: ml ? "വധു" : "Bride", value: `${r.bride_name || ""}${r.bride_father ? ` (${ml ? "പിതാവ്" : "d/o"} ${r.bride_father})` : ""}` },
        { label: ml ? "വരൻ" : "Groom", value: `${r.groom_name || ""}${r.groom_father ? ` (${ml ? "പിതാവ്" : "s/o"} ${r.groom_father})` : ""}` },
        { label: ml ? "സ്ഥലം" : "Place", value: r.place || "—" },
        { label: ml ? "മഹർ" : "Mahar", value: r.mahar || "—" },
      ],
    };
  }
  return {
    register_number: r.death_number || "—",
    cols: [
      { label: ml ? "പേര്" : "Name", value: r.deceased_name || "—" },
      { label: ml ? "പിതാവ് / ബന്ധു" : "Father / Kin", value: r.father_name || "—" },
      { label: ml ? "ലിംഗം" : "Sex", value: r.gender || "—" },
      { label: ml ? "വയസ്സ്" : "Age", value: r.age != null ? String(r.age) : "—" },
      { label: ml ? "മരണ തീയതി" : "Date of Death", value: fmtDate(r.date_of_death) },
      { label: ml ? "സ്ഥലം" : "Place", value: r.place_of_death || "—" },
      { label: ml ? "ദഫനം" : "Burial", value: `${fmtDate(r.burial_date)}${r.burial_place ? ` (${r.burial_place})` : ""}` },
    ],
  };
}

function fmtDate(d: string): string {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return String(d);
    return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
  } catch { return String(d); }
}

export function buildRegisterBookHtml(data: RegisterData, lang: 'en' | 'ml' = 'en'): string {
  const ml = lang === 'ml';
  const title = ml
    ? (data.type === "marriage" ? "നികാഹ് രജിസ്റ്റർ" : "മരണ രജിസ്റ്റർ")
    : (data.type === "marriage" ? "MARRIAGE REGISTER" : "DEATH REGISTER");
  const anekCss = getAnekMalayalamCss();
  const css = `${anekCss}
  @page{size:A4 landscape;margin:0}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:${ml ? '"Anek Malayalam Variable",' : ''}Poppins,"Anek Malayalam Variable","Segoe UI",Arial,sans-serif;color:#1a2b22;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:297mm;min-height:210mm;padding:8mm 10mm;position:relative;page-break-after:always}
  .page:last-child{page-break-after:auto}
  .head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:.4mm solid #0e7c5b;padding-bottom:2mm;margin-bottom:3mm}
  .head .t{font-size:14pt;font-weight:700;color:#0e7c5b;letter-spacing:1px}
  .head .s{font-size:8.5pt;color:#5f7268}
  table{width:100%;border-collapse:collapse;font-size:7.6pt}
  th,td{padding:1.3mm 1.8mm;border:.22mm solid #b9cfc3;text-align:left;vertical-align:top}
  th{background:#eef7f1;font-size:7pt;letter-spacing:.3px}
  td.num{font-family:'Courier New',monospace;font-weight:700;color:#0e7c5b;width:16mm}
  .foot{position:absolute;left:10mm;right:10mm;bottom:5mm;display:flex;justify-content:space-between;font-size:7pt;color:#8ba096;border-top:.2mm solid #cfdfd6;padding-top:1.5mm}
  .sign-row{display:flex;justify-content:space-between;margin-top:16mm}
  .sign{width:70mm;text-align:center}
  .sign .line{border-top:.3mm solid #5f7268;margin-top:16mm;padding-top:1.5mm;font-size:8pt}
  .integrity{margin-top:8mm;padding:3mm 4mm;border:.35mm solid #0e7c5b;border-radius:1.5mm;background:#f2faf6;font-size:8.5pt;text-align:center}
  `;

  const rows = data.rows.map((r) => mapRegisterRow(data.type, r, ml));
  const pageCount = Math.max(1, Math.ceil(rows.length / ENTRIES_PER_PAGE));
  const allCols = rows[0]?.cols.map((c) => c.label) || [];
  const headCols = `<tr><th class="num">#</th>${allCols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;

  const pages: string[] = [];
  for (let p = 0; p < pageCount; p++) {
    const slice = rows.slice(p * ENTRIES_PER_PAGE, (p + 1) * ENTRIES_PER_PAGE);
    const body = slice.length
      ? slice.map((r) => `<tr><td class="num">${esc(r.register_number)}</td>${r.cols.map((c) => `<td>${esc(c.value)}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${allCols.length + 1}" style="text-align:center;color:#8ba096">${ml ? "രേഖകളില്ല" : "No entries"}</td></tr>`;
    pages.push(`<div class="page">
      <div class="head"><div class="t">${title}</div><div class="s">${esc(data.mahalluName)} · ${ml ? "പേജ്" : "Page"} ${p + 1} / ${pageCount}</div></div>
      <table>${headCols}${body}</table>
      <div class="foot"><span>${esc(data.mahalluName)} — ${title}</span><span>${ml ? "പേജ്" : "Page"} ${p + 1} / ${pageCount} · ${ml ? "രേഖകൾ" : "Entries"} ${slice.length ? slice[0].register_number : "—"} – ${slice.length ? slice[slice.length - 1].register_number : "—"}</span></div>
    </div>`);
  }

  // Last page: signatures + integrity line
  const last = pages[pages.length - 1];
  const finalPage = last.replace(
    "</div>",
    `<div class="integrity">${ml
      ? `ഈ രജിസ്റ്ററിൽ ${rows.length} രേഖകളുണ്ട്. സ്ഥിരം ഇല്ലാതാക്കൽ നിർജ്ജീവമാക്കിയിരിക്കുന്നു — ഓരോ രേഖയും ഓഡിറ്റ് ട്രയിലിൽ രേഖപ്പെടുത്തിയിരിക്കുന്നു.`
      : `This register contains ${rows.length} entries. Permanent deletion is disabled — every entry is recorded in the tamper-evident audit trail.`}</div>
    <div class="sign-row">
      <div class="sign"><div class="line">${ml ? "സെക്രട്ടറി" : "Secretary"} · ${ml ? "ഒപ്പ്" : "Signature"}</div></div>
      <div class="sign"><div class="line">${ml ? "ഖാസി / പ്രസിഡന്റ്" : "Qazi / President"} · ${ml ? "ഒപ്പ്" : "Signature"}</div></div>
      <div class="sign"><div class="line">${ml ? "ഓഡിറ്റർ" : "Auditor"} · ${ml ? "ഒപ്പ്" : "Signature"}</div></div>
    </div>
  </div>`
  );
  pages[pages.length - 1] = finalPage;

  return `<!doctype html><html lang="${ml ? 'ml' : 'en'}"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${pages.join("")}</body></html>`;
}
