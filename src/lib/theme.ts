import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  apply: () => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "light",  // Design is light-first
      setTheme: (t) => {
        set({ theme: t });
        get().apply();
      },
      toggle: () => {
        const next = get().theme === "dark" ? "light" : "dark";
        set({ theme: next });
        get().apply();
      },
      apply: () => {
        const t = get().theme;
        const root = document.documentElement;
        if (t === "dark") {
          root.classList.add("dark");
          root.classList.remove("light");
        } else {
          root.classList.remove("dark");
          root.classList.add("light");
        }
        root.style.colorScheme = t;
      },
    }),
    {
      name: "mms-theme",
      onRehydrateStorage: () => (state) => {
        if (state) state.apply();
      },
    }
  )
);
