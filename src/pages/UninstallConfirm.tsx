/*
 * UninstallConfirm — the ONLY page rendered when the app is launched with
 * --verify-uninstall by the Windows uninstaller (NSIS customUnInit gate).
 *
 * The window is a small frameless 470x540 shell. This page fills it with a
 * brand-green screen and one job: collect the MMS administrator password,
 * verify it against the database, and exit with a code the uninstaller
 * understands (0 = proceed, 1 = cancelled/declined). No splash, no login,
 * no navigation — nothing else of the app boots in this mode.
 */
import { useEffect, useState } from "react";
import { LockKeyhole, ShieldCheck, CheckCircle2, AlertCircle, Database } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { useI18n } from "@/i18n";

type Phase = "boot" | "ask" | "verifying" | "verified" | "nodb";

const hasBridge = typeof window !== "undefined" && !!(window as any).mms?.uninstall;

export function UninstallConfirm() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("boot");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  /* Ask the main process whether a database exists at all. */
  useEffect(() => {
    if (!hasBridge) { setPhase("nodb"); return; }
    let cancelled = false;
    window.mms.uninstall.dbStatus()
      .then((r: { hasDb: boolean }) => { if (!cancelled) setPhase(r?.hasDb ? "ask" : "nodb"); })
      .catch(() => { if (!cancelled) setPhase("nodb"); });
    return () => { cancelled = true; };
  }, []);

  /* Escape = cancel the uninstall. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (ok: boolean) => {
    if (!hasBridge) return;
    try { void window.mms.uninstall.finish(ok); } catch { /* exiting */ }
  };

  const submit = async () => {
    if (!pwd.trim() || busy) return;
    setBusy(true); setError(""); setPhase("verifying");
    try {
      const r: any = await window.mms.uninstall.verify(pwd);
      if (r?.ok) {
        setPhase("verified");
        // Give the user a moment to see the confirmation, then signal the
        // uninstaller to proceed (exit code 0).
        setTimeout(() => finish(true), 1100);
      } else {
        setPhase("ask");
        setError(r?.reason === "no-database" ? t("un_nodb_title") : t("un_wrong"));
      }
    } catch {
      setPhase("ask");
      setError(t("un_wrong"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="uc-root">
      <div className="uc-glow uc-glow-a" aria-hidden="true" />
      <div className="uc-glow uc-glow-b" aria-hidden="true" />
      <div className="uc-card">
        <div className="uc-logo"><img src="./logo.png" alt="" /></div>

        {phase === "boot" && <div className="uc-boot"><div className="spinner-sm" /></div>}

        {phase === "nodb" && (
          <>
            <div className="uc-ic"><Database size={22} /></div>
            <h1 className="uc-title">{t("un_nodb_title")}</h1>
            <p className="uc-msg">{t("un_nodb_msg")}</p>
            <div className="uc-actions">
              <Button variant="secondary" onClick={() => finish(false)}>{t("un_cancel")}</Button>
              <Button variant="primary" onClick={() => finish(true)}>{t("un_continue")}</Button>
            </div>
          </>
        )}

        {(phase === "ask" || phase === "verifying") && (
          <>
            <div className="uc-ic"><LockKeyhole size={22} /></div>
            <h1 className="uc-title">{t("un_title")}</h1>
            <p className="uc-msg">{t("un_msg")}</p>
            <form className="uc-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <Label>{t("un_password")}</Label>
              <Input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="••••••••••"
                autoFocus
                disabled={phase === "verifying"}
              />
              {error && <div className="uc-error"><AlertCircle size={14} /> {error}</div>}
              <div className="uc-actions">
                <Button type="button" variant="secondary" onClick={() => finish(false)}>{t("un_cancel")}</Button>
                <Button type="submit" variant="primary" disabled={!pwd.trim() || phase === "verifying"}>
                  {phase === "verifying" ? t("un_verifying") : t("un_verify")}
                </Button>
              </div>
            </form>
          </>
        )}

        {phase === "verified" && (
          <>
            <div className="uc-ic ok"><CheckCircle2 size={26} /></div>
            <h1 className="uc-title">{t("un_title")}</h1>
            <p className="uc-msg ok">{t("un_verified")}</p>
            <div className="uc-verified-bar"><div className="spinner-sm" /> <span>{t("un_verifying")}</span></div>
          </>
        )}

        <div className="uc-note"><ShieldCheck size={14} /> {t("un_keep_note")}</div>
      </div>
    </div>
  );
}
