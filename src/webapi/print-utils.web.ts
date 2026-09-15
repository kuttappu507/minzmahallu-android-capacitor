/*
 * Browser replacement for electron/print/utils.ts (redirected by the Vite
 * build plugin for the Android bundle).
 *
 *   - esc()                identical HTML escaping
 *   - getAnekMalayalamCss() synchronous — returns the @fontsource CSS with
 *                           base64 data URIs, prepared at boot by
 *                           prepareAnekFontCss() (the boot sequence awaits it
 *                           BEFORE window.mms is installed, so every print
 *                           template renders with real Malayalam glyphs)
 *   - getPreviewScreenCss() bundled stylesheet for the certificate preview
 */
import fontCssRaw from "@fontsource-variable/anek-malayalam/wght.css?raw";
import mlWoff2 from "../assets/fonts/anek-malayalam-malayalam-wght-normal.woff2?url";
import latinWoff2 from "../assets/fonts/anek-malayalam-latin-wght-normal.woff2?url";
import latinExtWoff2 from "../assets/fonts/anek-malayalam-latin-ext-wght-normal.woff2?url";
import previewScreenCss from "../../resources/templates/preview-screen.css?raw";

export function esc(value: any): string {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
}

const FONT_URLS: Record<string, string> = {
  "anek-malayalam-malayalam-wght-normal.woff2": mlWoff2,
  "anek-malayalam-latin-wght-normal.woff2": latinWoff2,
  "anek-malayalam-latin-ext-wght-normal.woff2": latinExtWoff2,
};

let fontCssCache: string | null = null;

async function fetchBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as unknown as number[]);
    }
    return btoa(bin);
  } catch {
    return null;
  }
}

/** Boot-time: embed every referenced font file as a base64 data URI. */
export async function prepareAnekFontCss(): Promise<void> {
  if (fontCssCache) return;
  try {
    let css = fontCssRaw;
    for (const [basename, url] of Object.entries(FONT_URLS)) {
      const b64 = await fetchBase64(url);
      if (!b64) continue;
      css = css.split(basename).join(`data:font/woff2;base64,${b64}`);
    }
    fontCssCache = css;
  } catch {
    fontCssCache = "";
  }
}

export function getAnekMalayalamCss(): string {
  return fontCssCache ?? "";
}

export function getPreviewScreenCss(): string {
  return previewScreenCss;
}
