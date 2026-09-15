import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function esc(value: any): string {
  return String(value ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c] || c));
}

/**
 * Returns the full @fontsource-variable/anek-malayalam CSS (all weights,
 * latin + malayalam subsets) with each url(...) replaced by a base64 data URI
 * so the fonts render correctly inside a detached BrowserWindow used for
 * printToPDF. Without this, Malayalam glyphs fall back to "Segoe UI"/Arial
 * which don't have the Malayalam unicode block — the PDF shows empty boxes
 * or missing characters.
 *
 * Returns an empty string if the font package isn't resolvable (defensive).
 */
export function getAnekMalayalamCss(): string {
  try {
    const require = createRequire(import.meta.url);
    const cssPath = require.resolve('@fontsource-variable/anek-malayalam/wght.css');
    const css = readFileSync(cssPath, 'utf8');
    const cssDir = dirname(cssPath);
    return css.replace(/url\((['"]?)([^'"\)]+)\1\)/g, (_m, quote: string, relativePath: string) => {
      if (/^(data:|https?:|file:)/i.test(relativePath)) return `url(${quote}${relativePath}${quote})`;
      try {
        const fontPath = resolve(cssDir, relativePath);
        const base64 = readFileSync(fontPath).toString('base64');
        return `url("data:font/woff2;base64,${base64}")`;
      } catch {
        return `url(${quote}${relativePath}${quote})`;
      }
    });
  } catch {
    return '';
  }
}

/**
 * On-screen styles for the certificate preview popup, authored as a SEPARATE
 * stylesheet (resources/templates/preview-screen.css) so no component injects
 * inline <style> markup. The path resolves both in dev (repo/resources) and
 * packaged builds (app.asar/resources — resources/** ships in the asar).
 *
 * Returns an empty string if the file isn't found (defensive).
 */
export function getPreviewScreenCss(): string {
  try {
    // dist-electron/print/utils.js -> ../../resources/templates/preview-screen.css
    // (in source form under vitest: electron/print -> ../../resources/… — same depth)
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, '../../resources/templates/preview-screen.css'),
      resolve(here, '../../../resources/templates/preview-screen.css'),
      resolve(process.cwd(), 'resources/templates/preview-screen.css'),
    ];
    for (const c of candidates) {
      try { return readFileSync(c, 'utf8'); } catch { /* next */ }
    }
    return '';
  } catch {
    return '';
  }
}

