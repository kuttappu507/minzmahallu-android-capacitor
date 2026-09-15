/*
 * SecureActionDialog — gated confirmation for sensitive operations.
 *
 * Collects a REASON and the ADMINISTRATOR PASSWORD (re-verified in the main
 * process against the stored PBKDF2 hash), with an optional DATE field
 * (e.g. effective date of a resignation, or the date of the committee
 * minutes that approved a welfare amount). Every verification is written to
 * the audit log as ADMIN_REAUTH before the action itself runs.
 */
import { useState } from "react";
import { ShieldAlert, Lock } from "lucide-react";
import { Dialog, Button, Input, Label, Textarea } from "@/components/ui";
import { useI18n } from "@/i18n";
import { toast } from "@/lib/toast";

export interface SecureActionDialogProps {
  open: boolean;
  onClose: () => void;
  /** Async action executed after the password verifies. The password is
   *  included so actions that must RE-VERIFY in the main process (e.g. the
   *  WhatsApp receipt re-send) can — the renderer-side check here is only
   *  a first gate, never proof. */
  onConfirm: (ctx: { reason: string; date?: string; password: string }) => Promise<void> | void;
  title?: string;
  description?: string;
  /** Label for the optional date input (omit to hide the field). */
  dateLabel?: string;
  /** Default for the optional date input (ISO yyyy-mm-dd). */
  dateDefault?: string;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function SecureActionDialog({
  open, onClose, onConfirm, title, description, dateLabel, dateDefault,
  requireReason = true, reasonPlaceholder, confirmLabel, danger = true,
}: SecureActionDialogProps) {
  const { t, lang } = useI18n();
  const ml = lang === "ml";
  const tx = (en: string, m: string) => (ml ? m : en);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [date, setDate] = useState(dateDefault || "");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const reset = () => { setReason(""); setPassword(""); setDate(dateDefault || ""); };

  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (requireReason && !reason.trim()) {
      toast.error(tx("A reason is required", "കാരണം നൽകണം"));
      return;
    }
    if (!password) {
      toast.error(tx("Administrator password is required", "അഡ്മിൻ പാസ്‌വേഡ് ആവശ്യമാണ്"));
      return;
    }
    if (dateLabel && !date) {
      toast.error(tx("This date is required", "ഈ തീയതി ആവശ്യമാണ്"));
      return;
    }
    setBusy(true);
    try {
      // 1) Re-authenticate the administrator in the MAIN process.
      await window.mms.auth.verifyAdminPassword(password, title || "secure action", reason.trim());
      // 2) Execute the gated action.
      await onConfirm({ reason: reason.trim(), date: dateLabel ? date : undefined, password });
      reset();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || tx("Action failed", "പ്രവർത്തനം പരാജയപ്പെട്ടു"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title={title || tx("Confirm secure action", "സുരക്ഷിത പ്രവർത്തനം സ്ഥിരീകരിക്കുക")} className="modal-sm">
      <div className="dlg-pad space-y-4">
        <div className="dlg-hero t-rose">
          <div className="dlg-hero-ic"><ShieldAlert size={18} /></div>
          <div className="dlg-hero-body">
            <div className="dlg-hero-title">{description || tx("This action is recorded in the audit log.", "ഈ പ്രവർത്തനം ഓഡിറ്റ് ലോഗിൽ രേഖപ്പെടുത്തും.")}</div>
            <div className="dlg-hero-sub">{tx("Reason and administrator password are required", "കാരണവും അഡ്മിൻ പാസ്‌വേഡും ആവശ്യമാണ്")}</div>
          </div>
        </div>
        {dateLabel && (
          <div>
            <Label>{dateLabel} *</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}
        <div>
          <Label>{tx("Reason", "കാരണം")} {requireReason ? "*" : ""}</Label>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder || tx("Why is this action being performed?", "ഈ പ്രവർത്തനം നടത്തുന്നതിനുള്ള കാരണം?")}
          />
        </div>
        <div>
          <Label><Lock size={12} className="inline mr-1" />{tx("Administrator password", "അഡ്മിൻ പാസ്‌വേഡ്")} *</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          <div className="text-xs text-muted mt-1.5">{tx("Verified by the system — never stored.", "സിസ്റ്റം പരിശോധിക്കുന്നു — എവിടെയും സൂക്ഷിക്കുന്നില്ല.")}</div>
        </div>
        <div className="dlg-actions">
          <Button variant="secondary" onClick={close} disabled={busy}>{t("action_cancel")}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={submit} disabled={busy}>
            {busy ? tx("Verifying…", "പരിശോധിക്കുന്നു…") : (confirmLabel || tx("Confirm", "സ്ഥിരീകരിക്കുക"))}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
