import { esc } from './utils.js';
import { getDB } from '../db/connection.js';

function activeLanguage(): 'en' | 'ml' {
  try {
    const row = getDB().prepare("SELECT language FROM settings WHERE id = 1").get() as { language?: string } | undefined;
    return row?.language === 'ml' ? 'ml' : 'en';
  } catch { return 'en'; }
}

/** The printed header must show the MAHALLU'S OWN name (Settings), never a
 *  hardcoded brand — same contract as the receipt/certificate templates. */
function mahalluName(): string {
  try {
    const row = getDB().prepare("SELECT mahallu_name FROM settings WHERE id = 1").get() as { mahallu_name?: string } | undefined;
    const v = String(row?.mahallu_name || '').trim();
    return v || 'Mahallu';
  } catch { return 'Mahallu'; }
}

export function buildCollectionSheetHtml(tokenList: any[], event: any): string {
  const ml = activeLanguage() === 'ml';
  const name = esc(mahalluName());
  const labels = ml ? {
    title:'ടോക്കൺ ശേഖരണ ഷീറ്റ്', sub:`${name} · മഹല്ല് മാനേജ്മെന്റ് സിസ്റ്റം`, no:'നമ്പർ', token:'ടോക്കൺ', head:'കുടുംബനാഥൻ', family:'വീടിന്റെ പേര്', area:'പ്രദേശം', collected:'ശേഖരിച്ചു', signature:'ഒപ്പ്', verify:'ശേഖരിച്ചതായി അടയാളപ്പെടുത്തുന്നതിന് മുമ്പ് ഓരോ ടോക്കണും പരിശോധിക്കുക.', total:'ആകെ'
  } : {
    title:'Token Collection Sheet', sub:`${name} · Mahallu Management System`, no:'No.', token:'Token', head:'Family Head', family:'Family Name', area:'Area', collected:'Collected', signature:'Signature', verify:'Verify each returned token before marking collected.', total:'Total'
  };
  // Column order per request: No. | Token | FAMILY HEAD NAME | FAMILY NAME |
  // AREA (name only — no ward number, no house number) | Collected | Signature.
  const rows = tokenList.map((t: any, i: number) => `<tr><td class="no">${i + 1}</td><td class="code">${esc(t.token_code)}</td><td class="hname">${esc(t.house_head_name || '—')}</td><td>${esc(t.house_name || '—')}</td><td>${esc(t.area || t.ward || '—')}</td><td class="check">□</td><td></td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Poppins,"Anek Malayalam Variable","Segoe UI",Arial,sans-serif;color:#18231e;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{padding:13mm}.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.4mm solid #d5e3dd;padding-bottom:5mm;margin-bottom:6mm}.brand{display:flex;gap:3mm;align-items:center}.logo{width:10mm;height:10mm;border-radius:3mm;background:#159b78;color:#fff;display:grid;place-items:center;font-weight:800;font-size:5mm}.head h1{margin:0;font-size:6mm}.sub{font-size:2.3mm;color:#718078;margin-top:1mm}.event{text-align:right}.event b{display:block;color:#138466;font-size:3mm}.event span{font-size:2.2mm;color:#718078}table{width:100%;border-collapse:collapse;border:.3mm solid #d8e5df}th{background:#f3f7f5;color:#50615a;font-size:2.2mm;font-weight:700;padding:3mm 2.5mm;text-align:left;border-bottom:.3mm solid #d8e5df}td{font-size:2.8mm;padding:2.8mm 2.5mm;border-bottom:.25mm solid #e4ece8}tr:last-child td{border-bottom:0}.code{font:700 3.1mm "Courier New",monospace;color:#138466}.check{text-align:center;font-size:4mm;width:15mm}td:first-child{text-align:center;width:10mm;color:#819088}.hname{font-weight:600}td:last-child{width:30mm}.foot{margin-top:5mm;display:flex;justify-content:space-between;color:#819088;font-size:2mm}</style></head><body><section class="page"><header class="head"><div class="brand"><div class="logo">M</div><div><h1>${labels.title}</h1><div class="sub">${labels.sub}</div></div></div><div class="event"><b>${esc(event?.event_name || (ml ? 'ഇവന്റ്' : 'Event'))}</b><span>${esc(event?.event_date || '')}</span></div></header><table><thead><tr><th>${labels.no}</th><th>${labels.token}</th><th>${labels.head}</th><th>${labels.family}</th><th>${labels.area}</th><th>${labels.collected}</th><th>${labels.signature}</th></tr></thead><tbody>${rows}</tbody></table><div class="foot"><span>${labels.verify}</span><span>${labels.total}: ${tokenList.length}</span></div></section></body></html>`;
}
