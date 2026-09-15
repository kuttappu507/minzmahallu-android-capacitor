/*
 * MobileShell — the native Android app frame.
 *
 * Replaces the desktop Topbar + Sidebar when running on a phone (Capacitor
 * WebView or narrow viewport): a compact Material top app bar with the page
 * title and quick actions (language / theme), the content column, and the
 * floating island menu. Safe-area insets for the status bar and the gesture
 * navigation bar are honoured throughout.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/i18n";
import { IslandMenu } from "./IslandMenu";
import { PAGE_TITLE_KEYS } from "@/components/layout/navItems";

export function MobileShell({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const { t, lang, setLang } = useI18n();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const pageTitle = t(PAGE_TITLE_KEYS[location.pathname] || "nav_dashboard");

  // Any navigation closes the island (also covered inside IslandMenu).
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Lock body scroll while the island is open so the page behind never moves.
  useEffect(() => {
    document.body.classList.toggle("island-open", menuOpen);
    return () => document.body.classList.remove("island-open");
  }, [menuOpen]);

  return (
    <div id="app" className="app-shell mobile-shell">
      <header className="m-appbar">
        <div className="m-appbar-brand">
          <span className="m-appbar-tile"><img src="./logo-green.png" alt="MMS" /></span>
          <div className="m-appbar-titles">
            <b>MMS</b>
            <small>{pageTitle}</small>
          </div>
        </div>
        <div className="m-appbar-actions">
          <div className="langseg m-langseg">
            <button type="button" className={lang === "en" ? "on" : ""} onClick={() => setLang("en")} title={t("set_lang_english")}>EN</button>
            <button type="button" className={lang === "ml" ? "on" : ""} onClick={() => setLang("ml")} title="മലയാളം">മല</button>
          </div>
          <button className="ibtn" onClick={toggle} title={t("tb_toggle_theme")} aria-label="Theme">
            {theme === "dark" ? <Sun size={18} strokeWidth={2} /> : <Moon size={18} strokeWidth={2} />}
          </button>
        </div>
      </header>

      <main className="m-content" id="content">
        {children}
      </main>

      <IslandMenu open={menuOpen} onOpenChange={setMenuOpen} />
    </div>
  );
}
