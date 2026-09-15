import { useEffect, useState } from "react";

/**
 * True when the app should present the native Android shell (island menu,
 * app bar, card tables): running inside the Capacitor WebView, or any
 * viewport narrower than a small tablet.
 */
export function useIsMobile(): boolean {
  const [native] = useState<boolean>(() => !!((window as any).Capacitor?.isNativePlatform?.()));
  const [narrow, setNarrow] = useState<boolean>(() => window.matchMedia("(max-width: 820px)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return native || narrow;
}
