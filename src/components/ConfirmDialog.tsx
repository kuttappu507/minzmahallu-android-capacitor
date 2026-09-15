/*
 * ConfirmDialog — themed replacement for native confirm().
 * Uses Dialog from @/components/ui so it animates with modalIn.
 */
import { AlertTriangle } from "lucide-react";
import { Dialog, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, cancelLabel, danger = true }: ConfirmDialogProps) {
  const { t, lang } = useI18n();
  const ml = lang === "ml";
  const resolvedTitle = title ?? t("ui_confirm_delete");
  const resolvedDescription = description ?? (ml ? "ഈ രേഖ ഇല്ലാതാക്കണമെന്ന് ഉറപ്പാണോ?" : "Are you sure you want to delete this record?");
  const resolvedConfirm = confirmLabel ?? t("action_delete");
  const resolvedCancel = cancelLabel ?? t("action_cancel");

  if (!open) return null;
  return (
    <Dialog open={open} onClose={onClose} title={resolvedTitle} className="modal-sm">
      <div className="dlg-pad">
        <div className={cn("dlg-hero", danger ? "t-rose" : "t-em")}>
          <div className="dlg-hero-ic"><AlertTriangle size={18} /></div>
          <div className="dlg-hero-body">
            <div className="dlg-hero-title">{resolvedDescription}</div>
            <div className="dlg-hero-sub">{t("ui_permanent_action")}</div>
          </div>
        </div>
        <div className="dlg-actions">
          <Button variant="secondary" onClick={onClose}>{resolvedCancel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={async () => { await onConfirm(); }}>{resolvedConfirm}</Button>
        </div>
      </div>
    </Dialog>
  );
}
