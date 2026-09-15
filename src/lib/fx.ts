import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Interface-animation preference ("low-end mode").
 *
 * WHY THIS EXISTS: the sidebar collapse animates CSS `width`, which forces a
 * full-window relayout + repaint on every frame (the main column, its tables
 * and the gradient canvases all resize with it). On weak hardware a full-speed
 * glide once read as a glitch, so lowfx used to snap the sidebar instantly —
 * but the office found the instant jump too abrupt on EVERY machine. Lowfx now
 * keeps a slightly shorter, eased width glide (see globals.css) instead of
 * removing it, and only the hover/color transitions are dropped.
 *
 * AUTO DETECTION (Chromium APIs, evaluated once at load) — deliberately
 * CONSERVATIVE: only genuinely ancient hardware (<= 2 cores or <= 2 GB RAM)
 * opts into the reduced mode. Ordinary 4-core / 4 GB office machines run the
 * full animation fine now that transitions are paint-only (see globals.css),
 * and wrongly disabling it made capable PCs feel broken. Users can still
 * force either mode in Settings → Appearance.
 */

type FxPref = "auto" | "reduced" | "full";

const weakHardware =
  (typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 2) ||
  (typeof navigator !== "undefined" && ((navigator as any).deviceMemory ?? 8) <= 2);

interface FxState {
  pref: FxPref;
  /** Effective value after applying the preference (what html.lowfx mirrors). */
  reduced: boolean;
  setPref: (p: FxPref) => void;
  apply: () => void;
}

export const useFx = create<FxState>()(
  persist(
    (set, get) => ({
      pref: "auto",
      reduced: weakHardware,
      setPref: (p) => {
        set({ pref: p });
        get().apply();
      },
      apply: () => {
        const pref = get().pref;
        const reduced = pref === "auto" ? weakHardware : pref === "reduced";
        set({ reduced });
        document.documentElement.classList.toggle("lowfx", reduced);
      },
    }),
    {
      name: "mms-fx",
      onRehydrateStorage: () => (state) => {
        if (state) state.apply();
      },
    }
  )
);

// Apply immediately at module init: on a FRESH install (empty localStorage)
// zustand never invokes the rehydrate callback, so without this the detected
// html.lowfx class would be missing until the user touches the setting.
useFx.getState().apply();
