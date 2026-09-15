export type TokenPrintMode = "color" | "bw";

const esc = (value: unknown): string => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;").replace(/'/g, "&#39;");

// Cache the Anek Malayalam font CSS fetched from the main process so we don't
// re-fetch (and re-base64) for every print. The CSS embeds the full Variable
// font (latin + malayalam subsets, all weights) as data: URIs so Malayalam
// glyphs render correctly in the printToPDF BrowserWindow.
let anekFontCssCache: string | null = null;
export async function getAnekFontCss(): Promise<string> {
  if (anekFontCssCache !== null) return anekFontCssCache;
  let css = "";
  try {
    css = await window.mms.pdf.getAnekFontCss() || "";
  } catch {
    css = "";
  }
  anekFontCssCache = css;
  return css;
}

const palettes = [
  { head:"#1e3a8a", line:"#eab308", tokenBg:"#eef2fb", tokenLine:"#c9d4f0", tokenNum:"#1e3a8a", eventBg:"#fdf6e4", eventLine:"#ecd9a0", eventName:"#1e3a8a", eventTime:"#a16207", sep:"#d4a017", chipBg:"#f5f3ec", acc1:"#d4a017", acc2:"#0d9488" },
  { head:"#047857", line:"#eab308", tokenBg:"#ecfdf5", tokenLine:"#a7e3c9", tokenNum:"#065f46", eventBg:"#fdf6e4", eventLine:"#ecd9a0", eventName:"#065f46", eventTime:"#a16207", sep:"#d4a017", chipBg:"#f3f6f2", acc1:"#d4a017", acc2:"#0369a1" },
  { head:"#7c2d3b", line:"#e0a458", tokenBg:"#fdf0f0", tokenLine:"#eec3c3", tokenNum:"#7c2d3b", eventBg:"#fdf3ec", eventLine:"#ecd0b8", eventName:"#7c2d3b", eventTime:"#b45309", sep:"#e0a458", chipBg:"#f7f2ee", acc1:"#e0a458", acc2:"#0f766e" },
  { head:"#6d28d9", line:"#f0abfc", tokenBg:"#f4efff", tokenLine:"#d8c8fb", tokenNum:"#5b21b6", eventBg:"#faf5ff", eventLine:"#e9d5ff", eventName:"#5b21b6", eventTime:"#7e22ce", sep:"#a855f7", chipBg:"#f5f3ff", acc1:"#a855f7", acc2:"#0891b2" },
  { head:"#0f766e", line:"#facc15", tokenBg:"#ecfeff", tokenLine:"#b9e4e7", tokenNum:"#115e59", eventBg:"#f0fdfa", eventLine:"#bce8df", eventName:"#115e59", eventTime:"#0f766e", sep:"#d4a017", chipBg:"#f0f7f6", acc1:"#d4a017", acc2:"#2563eb" },
  { head:"#c2410c", line:"#fbbf24", tokenBg:"#fff7ed", tokenLine:"#fed7aa", tokenNum:"#9a3412", eventBg:"#fffaf0", eventLine:"#fed7aa", eventName:"#9a3412", eventTime:"#c2410c", sep:"#d97706", chipBg:"#fff7ed", acc1:"#d97706", acc2:"#0f766e" },
];

function paletteForEvent(eventId: unknown){
  const n = Math.max(0, Number(eventId || 1) - 1);
  return palettes[n % palettes.length];
}

export async function buildTokenSheetHtml(tokenList: any[], event: any, settings: any = {}, mode: TokenPrintMode = "color"): Promise<string> {
  const ml = settings?.language === "ml";
  const base = paletteForEvent(event?.id);
  const p = mode === "bw" ? {
    head:"#111", line:"#111", tokenBg:"#f3f3f3", tokenLine:"#999", tokenNum:"#111", eventBg:"#f4f4f4", eventLine:"#999", eventName:"#111", eventTime:"#333", sep:"#555", chipBg:"#f1f1f1", acc1:"#333", acc2:"#666"
  } : base;
  const labels = ml ? {
    card:"കാർഡ് നമ്പർ", familyNo:"കുടുംബ നമ്പർ", venue:"സ്ഥലം", event:"ഇവന്റ്", time:"സമയം"
  } : {
    card:"CARD NO", familyNo:"FAMILY NO", venue:"VENUE", event:"Event", time:"Time"
  };
  const mahallu = esc(settings?.mahallu_name || "Minz Mahallu");
  const contact = [settings?.address, settings?.phone].filter(Boolean).map(esc).join("  |  ");

  // Format event time as "Time: HH:MM AM/PM" in 12-hour format.
  // Input is typically "19:30" (24h from <input type="time">). If already
  // 12h with AM/PM, pass through. If empty, omit entirely.
  const rawTime = (event?.event_time || "").trim();
  let timeLabel = "";
  if (rawTime) {
    const m24 = rawTime.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) {
      let h = parseInt(m24[1], 10);
      const min = m24[2];
      const suffix = h >= 12 ? "PM" : "AM";
      h = h % 12; if (h === 0) h = 12;
      timeLabel = `${labels.time}: ${h}:${min} ${suffix}`;
    } else if (/AM|PM/i.test(rawTime)) {
      timeLabel = `${labels.time}: ${rawTime}`;
    } else {
      timeLabel = `${labels.time}: ${rawTime}`;
    }
  }

  const pages=[];
  for(let i=0;i<tokenList.length;i+=12) pages.push(`<section class="page">${tokenList.slice(i,i+12).map((t:any)=>{
    const headName = esc(t.house_head_name || t.house_name || "—");
    const houseName = esc(t.house_name || "—");
    const areaName = t.area ? esc(t.area) : "";
    return `
    <article class="card">
      <header class="head"><h1>${mahallu}</h1>${contact?`<p>${contact}</p>`:""}</header>
      <div class="mid">
        <div class="token"><small>${labels.card}</small><b>${esc(t.token_code)}</b></div>
        <div class="family"><h2>${headName}</h2><h3>${houseName}</h3>${areaName?`<h4>${areaName}</h4>`:""}</div>
        <div class="regs"><div class="r1"><small>${labels.familyNo}</small><b>${esc(t.family_number || "—")}</b></div></div>
      </div>
      <footer class="event"><h4>${esc(event?.event_name || labels.event)}</h4><p>${timeLabel ? `<b>${esc(timeLabel)}</b>` : ""}${timeLabel && event?.venue?`<span class="sep">◆</span>`:""}${event?.venue?`${labels.venue}: ${esc(event.venue)}`:""}</p></footer>
    </article>`;
  }).join("")}</section>`);
  // Fetch the embedded Anek Malayalam font CSS (cached). Without this, Malayalam
  // glyphs in the labels and event/venue names fall back to "Segoe UI"/Arial
  // which don't have the Malayalam unicode block — the PDF shows empty boxes.
  const anekFontFace = await getAnekFontCss();
  return `<!doctype html><html lang="${ml?'ml':'en'}"><head><meta charset="utf-8"><style>
@page{size:A4 portrait;margin:0}${anekFontFace}*{margin:0;padding:0;box-sizing:border-box}html,body{width:210mm;margin:0;background:#fff}body{font-family:${ml?'"Anek Malayalam Variable",':''}"Segoe UI","Anek Malayalam Variable",Arial,sans-serif;color:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{width:210mm;height:297mm;padding:8mm;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(6,44.75mm);gap:2.5mm;page-break-after:always;overflow:hidden}.page:last-child{page-break-after:auto}.card{border:.4mm solid ${p.tokenLine};border-radius:2.5mm;overflow:hidden;display:flex;flex-direction:column;background:#fff}.head{background:${p.head};color:#fff;text-align:center;padding:1.8mm 2mm 1.5mm;border-bottom:.7mm solid ${p.line};min-height:11mm}.head h1{font-size:12pt;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.head p{font-size:6.6pt;opacity:.92;margin-top:.6mm;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mid{flex:1;display:flex;align-items:stretch;gap:2mm;padding:2.5mm 2mm 1.5mm;background:#fff;overflow:hidden}.token{width:20mm;background:${p.tokenBg};border:.35mm solid ${p.tokenLine};border-radius:2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;flex:none}.token small{font-size:5.5pt;font-weight:800;color:${p.eventTime};text-align:center;line-height:1.1}.token b{font-size:14pt;color:${p.tokenNum};letter-spacing:.5px}.family{flex:1;text-align:center;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1mm;padding-top:1mm}.family h2{font-size:13.5pt;color:#1e293b;font-weight:800;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.family h3{font-size:9.5pt;color:#64748b;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.family h4{font-size:8pt;color:#94a3b8;font-weight:500;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:.5mm}.regs{width:20mm;display:flex;flex-direction:column;justify-content:center;gap:1.3mm;flex:none}.regs div{background:${p.chipBg};border-radius:1.5mm;padding:1.1mm 1.4mm}.regs .r1{border-left:.7mm solid ${p.acc1}}.regs small{display:block;font-size:5.2pt;color:#64748b;font-weight:700;white-space:nowrap}.regs b{font-size:10pt;color:#1e293b;white-space:nowrap}.event{background:${p.eventBg};border-top:.3mm solid ${p.eventLine};text-align:center;padding:1.6mm 2mm 1.8mm}.event h4{font-size:13pt;font-weight:800;color:${p.eventName};line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.event p{font-size:7.4pt;color:#475569;margin-top:.8mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.event p b{color:${p.eventTime}}.event .sep{color:${p.sep};margin:0 1.2mm}${mode==="bw"?`.head{background:#111!important;border-bottom-color:#111!important}.token b,.family h2,.event h4{color:#111!important}.event{background:#f4f4f4!important;border-top-color:#999!important}.token{background:#f3f3f3!important}.regs div{background:#f1f1f1!important}`:""}</style></head><body>${pages.join("")}</body></html>`;
}
