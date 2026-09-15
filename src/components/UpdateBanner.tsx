/*
 * UpdateBanner — non-blocking "new version available" notice.
 *
 * Shown when the main process's monthly GitHub release check finds a newer
 * release (push event) or when a previous check already found one and the
 * window was reloaded (status pull). Dismissing hides the notice for the
 * SAME version permanently (localStorage) — a newer version re-shows it.
 *
 * "Download update" opens the release's installer ASSET directly (one click
 * → the .exe download starts) so the office never has to find the right file
 * on the GitHub release page. "Release page" is kept as the secondary path
 * for release notes / manual download. No auto-install: the user stays in
 * control of when the new version is actually run.
 */
import { useEffect, useState } from "react";
import { DownloadCloud, X } from "lucide-react";
import { useI18n } from "@/i18n";

type UpdateInfo = { latestVersion: string; url: string; downloadUrl?: string | null; currentVersion: string };

const DISMISS_KEY = "mms-update-dismissed-version";

export default function UpdateBanner() {
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unbind: (() => void) | undefined;
    let timer: number | undefined;

    const showIfNotDismissed = (u: UpdateInfo | null) => {
      if (!u || cancelled) return;
      try {
        if (localStorage.getItem(DISMISS_KEY) === u.latestVersion) return;
      } catch { /* private mode — just show */ }
      setInfo(u);
      setHidden(false);
    };

    const bind = (): boolean => {
      const mms = window.mms as any;
      if (!mms?.updates && !mms?.events) return false;
      // 1) Re-show after a reload if a previous check already found an update.
      mms?.updates?.status?.().then((s: any) => {
        if (s?.updateAvailable && s.latestVersion) {
          showIfNotDismissed({ latestVersion: s.latestVersion, url: s.url || "", downloadUrl: s.downloadUrl ?? null, currentVersion: s.currentVersion || "" });
        }
      }).catch(() => {});
      // 2) Live push from the monthly check (or a manual Settings check).
      unbind = mms?.events?.onUpdateAvailable?.((u: UpdateInfo) => showIfNotDismissed(u));
      return true;
    };

    /* The Electron preload exposes window.mms BEFORE any page script runs, so
       the first attempt always binds. The dev browser preview installs the
       mock AFTER the first render — retry briefly instead of missing it. */
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      if (bind() || ++tries > 24) return; // give up after ~6s
      timer = window.setTimeout(attempt, 250);
    };
    attempt();

    return () => { cancelled = true; if (timer) window.clearTimeout(timer); try { unbind?.(); } catch { /* mock */ } };
  }, []);

  if (!info || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, info.latestVersion); } catch { /* ignore */ }
  };
  const openRelease = () => { window.mms?.updates?.openReleasePage?.().catch(() => {}); };
  const hasDownload = !!info.downloadUrl;

  return (
    <div className="upd-banner" role="status" data-testid="update-banner">
      <div className="upd-ic"><DownloadCloud size={16} /></div>
      <div className="upd-text">
        <div className="upd-title">
          {t("upd_title")}
          <span className="upd-ver">v{info.latestVersion}</span>
        </div>
        <div className="upd-body">{t("upd_body")}</div>
      </div>
      <div className="upd-actions">
        {hasDownload && (
          <button className="upd-btn" onClick={() => { window.mms?.updates?.openDownload?.().catch(() => {}); }}>{t("upd_download")}</button>
        )}
        <button className={`upd-btn${hasDownload ? " upd-btn-ghost" : ""}`} onClick={openRelease}>
          {hasDownload ? t("upd_release_page") : t("upd_open")}
        </button>
        <button className="upd-btn upd-btn-ghost" onClick={dismiss}>{t("upd_later")}</button>
      </div>
      <button className="upd-x" onClick={dismiss} aria-label="Dismiss" title={t("upd_later")}>
        <X size={14} />
      </button>
    </div>
  );
}
