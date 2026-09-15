import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";

/** Keep in sync with package.json "version". */
const APP_VERSION = "2.0.0";

type Lang = "en" | "ml";

interface BootStep {
  msg: string;
  pct: number;
}

const BOOT_STEPS: Record<Lang, BootStep[]> = {
  en: [
    { msg: "Initializing database", pct: 16 },
    { msg: "Loading schema", pct: 34 },
    { msg: "Applying migrations", pct: 55 },
    { msg: "Preparing modules", pct: 76 },
    { msg: "Finalizing setup", pct: 90 },
  ],
  ml: [
    { msg: "ഡാറ്റാബേസ് തുറക്കുന്നു", pct: 16 },
    { msg: "സ്കീമ ലോഡ് ചെയ്യുന്നു", pct: 34 },
    { msg: "മൈഗ്രേഷനുകൾ പ്രയോഗിക്കുന്നു", pct: 55 },
    { msg: "മൊഡ്യൂളുകൾ തയ്യാറാക്കുന്നു", pct: 76 },
    { msg: "സജ്ജീകരണം പൂർത്തിയാക്കുന്നു", pct: 90 },
  ],
};

const STEP_INTERVAL = 340; // ms between boot steps
const STEP_ANIM = 320; // ms progress easing per step
const EXIT_ANIM = 460; // ms exit fade duration

export function Splash({ onDone }: { onDone: () => void }) {
  const { lang, t } = useI18n();
  const [status, setStatus] = useState(BOOT_STEPS[lang][0].msg);
  const [target, setTarget] = useState(BOOT_STEPS[lang][0].pct);
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState(false);
  const shown = useRef(0);

  /* Smoothly ease the displayed progress toward the current target. */
  useEffect(() => {
    const from = shown.current;
    if (target <= from) return;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / STEP_ANIM);
      const eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
      shown.current = from + (target - from) * eased;
      setProgress(Math.round(shown.current));
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  /* Boot sequence: walk the checklist, then finish and hand off to the app. */
  useEffect(() => {
    const steps = BOOT_STEPS[lang];
    let i = 0;
    const advance = () => {
      if (i < steps.length) {
        setStatus(steps[i].msg);
        setTarget(steps[i].pct);
        i += 1;
      } else {
        clearInterval(stepTimer);
      }
    };
    advance();
    const stepTimer = setInterval(advance, STEP_INTERVAL);
    const finishTimer = setTimeout(() => {
      clearInterval(stepTimer);
      setStatus(lang === "ml" ? "തയ്യാർ" : "Ready");
      setTarget(100);
      setOut(true);
      setTimeout(onDone, EXIT_ANIM + 60);
    }, steps.length * STEP_INTERVAL + 280);
    return () => {
      clearInterval(stepTimer);
      clearTimeout(finishTimer);
    };
  }, [onDone, lang]);

  return (
    <div
      className={`splash ${out ? "out" : ""}`}
      role="status"
      aria-label="Minz Mahallu Management System"
    >
      {/* The generous splash box — the balance area of the window stays
          transparent (desktop shows through) in both dark and light mode. */}
      <div className="splash-card">
        <div className="splash-bg" aria-hidden="true">
          <div className="splash-glow splash-glow-a" />
          <div className="splash-glow splash-glow-b" />
          <div className="splash-pattern" />
          <div className="splash-vignette" />
        </div>

        <div className="splash-logo">
          <img src="./logo.png" alt="" />
        </div>

        <div className="splash-brand">
          <h1 className="splash-title">Minz Mahallu</h1>
          <p className="splash-subtitle">
            {t("app_name")}
            {lang === "ml" ? " സിസ്റ്റം" : " System"}
          </p>
        </div>

        <div className="splash-divider" aria-hidden="true">
          <span />
          <i />
          <span />
        </div>

        <div className="splash-progress-wrap">
          <div className="splash-progress-meta">
            <span key={status} className="splash-status">
              {status}
            </span>
            <span className="splash-pct">{progress}%</span>
          </div>
          <div className="splash-progress" aria-hidden="true">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Footer lives inside the box (outside is transparent) */}
        <div className="splash-foot">
          <span className="splash-version">Version {APP_VERSION}</span>
          <span className="splash-dot" aria-hidden="true" />
          <span className="splash-credit">
            {lang === "ml" ? "MinZ വികസിപ്പിച്ചത്" : "Developed by MinZ"}
          </span>
        </div>
      </div>
    </div>
  );
}
