/*
 * IslandMenu — the Android replacement for the desktop sidebar.
 *
 * A floating island button sits above the bottom gesture area; tapping it
 * raises a Material-You style popup panel with every screen as a tile
 * (icon + name), grouped by section, with the active route highlighted.
 * The island springs from the button itself (framer-motion), sits on a
 * scrim, and closes on navigation or outside tap.
 */
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, LogOut, Landmark } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { NAV, TINTS, SECTION_LABELS, MOBILE_EXCLUDED_IDS, isSection, type NavItem } from "@/components/layout/navItems";
import { cn } from "@/lib/utils";

interface IslandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IslandMenu({ open, onOpenChange }: IslandMenuProps) {
  const { t, lang } = useI18n();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const ml = lang === "ml";

  // Close whenever the route changes.
  useEffect(() => { onOpenChange(false); }, [location.pathname, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const items = useMemo(() => NAV.filter((e): e is NavItem => !isSection(e) && !MOBILE_EXCLUDED_IDS.has(e.id)), []);
  const sections = useMemo(() => NAV.filter(isSection).map((s) => s.sec), []);

  const groupOf = (id: string): string => {
    let current = "";
    for (const e of NAV) {
      if (isSection(e)) current = e.sec;
      else if (e.id === id) return current;
    }
    return "";
  };

  const go = (to: string, end?: boolean) => {
    onOpenChange(false);
    navigate(to, { replace: false });
    void end;
  };

  const handleLogout = async () => {
    onOpenChange(false);
    await logout();
    navigate("/login");
  };

  const sectionText = (s: string) => (ml ? SECTION_LABELS[s] || s : s);

  return (
    <>
      {/* Floating island button */}
      <motion.button
        type="button"
        className="island-fab"
        aria-label={ml ? "മെനു" : "Menu"}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        whileTap={{ scale: 0.94 }}
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
      >
        <motion.span
          className="island-fab-ic"
          animate={open ? { rotate: 90 } : { rotate: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
        >
          <Landmark size={22} strokeWidth={2.1} />
        </motion.span>
        <b>{ml ? "മെനു" : "Menu"}</b>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="island-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={() => onOpenChange(false)}
            />
            <motion.div
              className="island-panel"
              role="dialog"
              aria-label={ml ? "നാവിഗേഷൻ" : "Navigation"}
              initial={{ opacity: 0, y: 48, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 32, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            >
              <div className="island-head">
                <span className="island-avatar">{user?.initials ?? "?"}</span>
                <div className="island-user">
                  <b>{user?.fullName ?? "—"}</b>
                  <small>{user?.role ?? ""}</small>
                </div>
                <button className="ibtn island-close" onClick={() => onOpenChange(false)} aria-label="Close">
                  <X size={17} />
                </button>
              </div>

              <div className="island-scroll">
                {items.map((item, idx) => {
                  const active = location.pathname === item.to || (item.to === "/" && location.pathname === "/");
                  const sec = groupOf(item.id);
                  const showSec = idx === 0 || groupOf(items[idx - 1].id) !== sec;
                  const Icon = item.icon;
                  return (
                    <div key={item.id}>
                      {showSec && sec && <p className="island-sec">{sectionText(sec)}</p>}
                      <motion.button
                        type="button"
                        className={cn("island-item", TINTS[item.id], active && "on")}
                        onClick={() => go(item.to, item.to === "/")}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(0.018 * idx, 0.22), duration: 0.16 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <span className="island-item-ic"><Icon size={19} strokeWidth={2} /></span>
                        <span className="island-item-nm">{t(item.key)}</span>
                      </motion.button>
                    </div>
                  );
                })}
              </div>

              <div className="island-foot">
                <button type="button" className="island-logout" onClick={handleLogout}>
                  <LogOut size={16} strokeWidth={2} />
                  <b>{t("action_logout")}</b>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
