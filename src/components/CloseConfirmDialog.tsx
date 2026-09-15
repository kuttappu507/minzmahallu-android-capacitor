/*
 * CloseConfirmDialog — the app-wide "Close MMS?" gate.
 * The main process intercepts the window's close event (X button, Alt+F4,
 * taskbar close) and asks the renderer to confirm. This dialog is that
 * confirmation: "Close app" really quits; "Keep open" (or Escape / clicking
 * outside) just dismisses it and the app stays open.
 */
import { useEffect, useState } from "react";
import { PowerOff } from "lucide-react";
import { Dialog, Button } from "@/components/ui";
import { useI18n } from "@/i18n";

export function CloseConfirmDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!window.mms?.win?.onAskClose) return;
    const unsubscribe = window.mms.win.onAskClose(() => {
      setOpen(true);
      setClosing(false);
    });
    return unsubscribe;
  }, []);

  const confirmClose = async () => {
    setClosing(true);
    try { await window.mms.win.confirmClose(); } catch { /* window already gone */ }
    // If the close failed for any reason, re-arm the dialog.
    setClosing(false);
  };

  if (!open) return null;
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title={t("close_confirm_title")} className="modal-sm">
      <div className="dlg-pad">
        <div className="dlg-hero t-em">
          <div className="dlg-hero-ic"><PowerOff size={18} /></div>
          <div className="dlg-hero-body">
            <div className="dlg-hero-title">{t("close_confirm_msg")}</div>
            <div className="dlg-hero-sub">{t("close_confirm_sub")}</div>
          </div>
        </div>
        <div className="dlg-actions">
          <Button variant="secondary" onClick={() => setOpen(false)}>{t("close_confirm_no")}</Button>
          <Button variant="primary" onClick={confirmClose} disabled={closing}>{t("close_confirm_yes")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
