import { useEffect, useRef, useState } from "react";
import { Tokens } from "@/pages/Tokens";
import { buildTokenSheetHtml, type TokenPrintMode } from "@/lib/tokenPrint";
import { toast } from "@/lib/toast";
import { useI18n } from "@/i18n";

export function TokensWithPrint() {
  const { lang } = useI18n();
  const [mode, setMode] = useState<TokenPrintMode>("color");
  const [printing, setPrinting] = useState(false);
  const lastEventId = useRef(0);
  const ml = lang === "ml";

  useEffect(() => {
    const rememberEvent = () => {
      const select = document.querySelector(".vhead select") as HTMLSelectElement | null;
      const id = Number(select?.value || 0);
      if (id) lastEventId.current = id;
    };
    rememberEvent();
    const timer = window.setInterval(rememberEvent, 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onClickCapture = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button || printing) return;
      const label = (button.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!label.includes(ml ? "ടോക്കൺ pdf" : "token pdf")) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      const select = document.querySelector(".vhead select") as HTMLSelectElement | null;
      const eventId = Number(select?.value || 0) || lastEventId.current;
      if (!eventId) { toast.error(ml ? "ആദ്യം ഒരു ഇവന്റ് തിരഞ്ഞെടുക്കുക" : "Please select an event first"); return; }
      setPrinting(true);
      try {
        const [tokenList, eventData, loadedSettings] = await Promise.all([
          window.mms.tokens.listForPdf(eventId),
          window.mms.tokens.getEvent(eventId),
          window.mms.settings.load(),
        ]);
        if (!tokenList?.length) { toast.error(ml ? "ഈ ഇവന്റിന് ടോക്കണുകളൊന്നുമില്ല" : "No tokens found for this event"); return; }
        const settings = { ...(loadedSettings || {}), language: lang };
        const html = await buildTokenSheetHtml(tokenList, eventData, settings, mode);
        const safeName = String(eventData?.event_name || eventId).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || String(eventId);
        const result = await window.mms.pdf.generate(html, `tokens-${safeName}${mode === "bw" ? "-bw" : ""}.pdf`);
        if (result?.success) toast.success(ml ? `${tokenList.length} ടോക്കണുകളുടെ PDF തയ്യാറാക്കി` : `${mode === "bw" ? "Black & white token PDF" : "Token PDF"} generated (${tokenList.length} tokens)`);
      } catch (e: any) { toast.error(e.message || (ml ? "PDF തയ്യാറാക്കാൻ കഴിഞ്ഞില്ല" : "Failed to generate PDF")); }
      finally { setPrinting(false); }
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [lang, ml, mode, printing]);

  return (
    <div className="token-print-shell">
      <Tokens printModeControl={<div className="token-print-mode" role="group" aria-label={ml ? "പ്രിന്റ് മോഡ്" : "Token print mode"}><span>{ml ? "പ്രിന്റ്" : "Print"}</span><button type="button" className={mode === "color" ? "on" : ""} onClick={() => setMode("color")} disabled={printing}>{ml ? "നിറം" : "Color"}</button><button type="button" className={mode === "bw" ? "on" : ""} onClick={() => setMode("bw")} disabled={printing}>{ml ? "കറുപ്പ് & വെളുപ്പ്" : "B&W"}</button></div>} />
      <style>{`
        .token-print-shell{position:relative}
        .token-print-mode{display:inline-flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--line);background:var(--panel);border-radius:9px;box-shadow:var(--sh);font:500 11px Poppins;color:var(--mut);white-space:nowrap}
        .token-print-mode>span{padding:0 5px 0 7px;color:var(--fnt)}
        .token-print-mode button{border:0;background:transparent;color:var(--mut);border-radius:8px;padding:5px 9px;cursor:pointer;font:500 11px Poppins}
        .token-print-mode button.on{background:var(--em);color:#fff;box-shadow:0 2px 0 var(--emdd)}
        .token-print-mode button:disabled{opacity:.5;cursor:not-allowed}
      `}</style>
    </div>
  );
}
